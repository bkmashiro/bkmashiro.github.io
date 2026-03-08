---
title: "Security Audit of a Refactored NestJS App: What We Found"
description: "After adding 50+ new endpoints during a major refactor, we ran a systematic security audit using a permission matrix. Here's what we discovered — including a privilege escalation bug and a FIXME left in production for years."
date: 2026-03-08
readingTime: true
tag:
  - Security
  - NestJS
  - Backend
  - Auth
outline: [2, 3]
---

When you add 50+ new endpoints to a production application, you don't just have a new application — you have a new attack surface. The Leverage OJ backend rewrite touched nearly every route in the system, introduced a new role hierarchy, and replaced the entire authentication layer. That's exactly the kind of change that creates permission bugs: the kind where access controls that worked in the old system either didn't get ported, or got ported incorrectly.

We did a systematic security audit before going live. This post describes the methodology and what we found — including one regression that would have let the wrong users trigger re-evaluation of submitted code, and one FIXME comment that had been sitting in production without access control for years.

## The Setup: What Changed

The original Leverage OJ backend had a fairly flat role structure. The rewrite introduced a cleaner three-tier hierarchy:

- **User** — standard authenticated user; can submit solutions, view own submissions
- **Supervisor** — can manage problems, view all submissions, trigger re-judging
- **Admin** — full system access, user management, system configuration

The old codebase used `express-session` with custom middleware to check roles inline. The new codebase uses NestJS guards:

```typescript
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.Supervisor)
@Post('/rejudge/:id')
async rejudge(@Param('id') id: number) {
  // ...
}
```

The migration from inline middleware to declarative guards should be an improvement. And it is — when the roles are assigned correctly.

## Audit Methodology: The Permission Matrix

Rather than auditing endpoints one by one in an ad-hoc way, we built a **permission matrix**: a table mapping every endpoint to its expected access level.

The format is simple:

| Endpoint | Method | Expected Role | Actual Guard | Status |
|----------|--------|---------------|--------------|--------|
| `/problems` | GET | Public | None | ✅ |
| `/problems/:id` | GET | User | JwtAuthGuard | ✅ |
| `/problems` | POST | Supervisor | JwtAuthGuard + RolesGuard(Supervisor) | ✅ |
| `/submissions/:id/rejudge` | POST | Supervisor | JwtAuthGuard + RolesGuard(Admin) | ❌ |
| `/submissions/:id/inspect` | GET | Supervisor | None | ❌ |

The process:

1. Export all routes with their method and path (NestJS can enumerate these via the `RoutesResolver` or by reading the module structure)
2. Assign an expected access level to each route based on what the endpoint does
3. Read the actual guard decorators from the source
4. Flag any mismatches

It's tedious but not complicated. With 50+ new endpoints, it took about three hours to populate the matrix completely.

## What We Found

### Finding 1: `rejudge` Permission Regression

The `rejudge` endpoint — which re-queues a submission for judging — should require **Supervisor** access. Supervisors routinely need to re-trigger judging when a judge crashes mid-evaluation or when a problem's test cases are updated.

During the refactor, the guard was set to `Role.Admin`:

```typescript
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.Admin)  // ← wrong
@Post('/submissions/:id/rejudge')
async rejudge(@Param('id') id: number) {
  return this.judgeService.rejudge(id)
}
```

This is a **privilege escalation in the wrong direction**: the endpoint became *more* restricted than it should be, effectively removing supervisor access to a feature they need. The symptom in production would be supervisors getting 403 errors when trying to re-judge submissions — frustrating but not a security vulnerability.

But mismatches in either direction indicate the permission model isn't being applied consistently, which is itself a problem. If one guard was set wrong, others might be too.

Fix:

```typescript
@Roles(Role.Supervisor)  // ← correct: supervisors and above
```

### Finding 2: The FIXME That Became Production Code

The more concerning finding was in the original codebase's `/submissions/:id/inspect` endpoint. This endpoint returns the full details of a submission — including the submitted code and the judge's internal evaluation log.

In the original source:

```typescript
// FIXME: should check permissions here
@Get('/submissions/:id/inspect')
async inspect(@Param('id') id: number) {
  return this.submissionsService.getFullDetails(id)
}
```

No auth guard. No role check. Any request with the submission ID — authenticated or not — could retrieve the full contents of any submission in the system.

The `// FIXME` comment suggests someone knew this was wrong. They wrote the endpoint, noted the missing access control, and either ran out of time or forgot to come back. The comment survived in the codebase for long enough to make it into production.

This is a meaningful data exposure: submitted code is intellectual property, and in a contest context, being able to read other users' solutions in real-time is a direct form of cheating. The fact that submission IDs are sequential integers makes enumeration trivial.

The new backend fixed this in two ways:

```typescript
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.Supervisor)
@Get('/submissions/:id/inspect')
async inspect(@Param('id') id: number, @CurrentUser() user: User) {
  return this.submissionsService.getFullDetails(id)
}
```

Supervisors can inspect any submission. Regular users cannot inspect submissions at all — if they want to see their own code, they use the standard submission detail endpoint, which only returns the user's own submissions.

## Security Improvements in the New Architecture

Beyond the specific findings, the rewrite introduced structural changes that make the permission model harder to get wrong.

### `ValidationPipe` with `whitelist: true`

The original backend accepted arbitrary request body properties and passed them to TypeORM. If a client sent extra fields in a POST body — say, `role: 'admin'` in a registration request — those fields could potentially reach the database depending on how the entity was configured.

The new backend configures `ValidationPipe` globally:

```typescript
app.useGlobalPipes(
  new ValidationPipe({
    whitelist: true,       // strip unknown properties
    forbidNonWhitelisted: true,  // throw if unknown properties are present
    transform: true,       // auto-transform to DTO types
  })
)
```

`whitelist: true` strips any property not declared in the DTO class. `forbidNonWhitelisted: true` goes further and throws a 400 error if the client sends unknown fields. This prevents mass assignment attacks entirely at the framework level.

### `JwtAuthGuard` + `RolesGuard` as Separate Layers

In the original system, auth and authorization were combined in single middleware functions. The new system separates them cleanly:

- `JwtAuthGuard` validates the JWT and attaches the user to the request. It has one job.
- `RolesGuard` reads the `@Roles()` decorator and checks that the attached user has the required role. It has one job.

This separation makes each guard independently testable and makes permission bugs easier to spot in code review. When you see `@UseGuards(JwtAuthGuard, RolesGuard)` followed by `@Roles(Role.Supervisor)`, the intent is unambiguous.

For endpoints that need authentication but not a specific role, only `JwtAuthGuard` is applied. For public endpoints, neither guard is applied. The pattern is explicit rather than implicit.

## Lessons

**Run a permission audit after any large refactor.** The matrix approach scales — it's mechanical enough that it can be partially automated, and it surfaces mismatches that are invisible to anyone looking at individual endpoints in isolation. The `rejudge` regression looked correct in isolation (it had a guard! it had a role requirement!), but only showed up as wrong when compared against expected behavior.

**FIXME comments are security vulnerabilities waiting to happen.** A comment noting missing access control is better than nothing, but it's not a fix. In a production codebase, a `// FIXME: add auth` comment should be treated as a known vulnerability until it's resolved.

**Explicit over implicit.** The original middleware approach made it easy to forget to apply auth checks. The decorator approach in NestJS makes it easy to *see* when a route has no guard — the absence of `@UseGuards()` is visually obvious. The cost of being explicit is a few extra lines of code. The benefit is that security requirements are documented in the source.

The audit took a few hours. The bugs it found would have cost much more than that to deal with after going live.
