---
title: "JWT vs Session: Why We Replaced the Entire Auth System"
description: "The session-based auth in Leverage OJ had three fundamental problems. Here's the design behind the JWT replacement — including the trade-offs we made and the ones we deferred."
date: 2026-03-08
readingTime: true
tag:
  - Systems
  - NestJS
  - Auth
  - JWT
  - Security
outline: [2, 3]
---

Authentication is one of those things that feels solved — until you inherit a codebase where it isn't. When I started the Leverage OJ rewrite, the auth system was three separate problems wearing a trench coat: a session setup that broke under PM2, a ContestUser concept that had diverged into its own parallel auth universe, and a password hashing scheme that was one config leak away from a full credential dump.

None of these were immediately obvious. The system *worked* — users could log in, sessions persisted, contests ran. But "works" and "correct" are different things, and the closer I looked, the more I saw a system that had accumulated assumptions that were no longer valid.

## What Was Wrong with Sessions

### PM2 Cluster Breaks In-Memory State

The original system used `express-session` with a Redis store — a standard setup. Except it wasn't quite standard.

The Redis store handles session persistence correctly in theory: sessions are stored in Redis, any process can read them. But the original code had accumulated stateful in-memory data that lived *alongside* the session store. The `pendingSet` for ranking rebuilds is the most egregious example (I documented that bug in the code review post), but the auth module had its own version of this: device binding checks that mixed in-memory state with session data in ways that were correct only if one process handled the entire lifecycle of a request chain.

PM2 cluster mode assigns incoming requests to workers in round-robin. If your auth setup touches in-memory state that's different from the session store — even briefly — you get consistency failures that only appear under load, only in production, and are nearly impossible to reproduce in development.

The standard advice is "just use a Redis session store" and everything works. That's mostly true, but it requires the rest of your code to be truly stateless. The original Leverage code wasn't.

### Two Auth Systems Running in Parallel

The harder problem was ContestUser.

Leverage has two kinds of users: regular users who have accounts on the platform, and contest users who might be temporary participants with separate credentials, IP binding requirements, and different access rules. The original system solved this by having *two entirely separate authentication paths* that didn't share logic.

Regular user auth: `express-session`, standard middleware, user ID in session.

Contest user auth: custom middleware, different session namespace, contest-specific fields, IP checks inline with route handlers.

The result was two codebases that did the same thing (verify identity, attach user context to request) with completely different implementations. Any bug fix, any new requirement — two places to update. Any security improvement — two places to get wrong.

### Session's Structural Problem

There's a deeper issue beneath the implementation details: HTTP sessions are fundamentally stateful, and statefulness is the enemy of horizontal scaling.

For Leverage's current scale, this doesn't matter. But the rewrite is also about setting up infrastructure that doesn't need to be thrown away in two years. If you want to run multiple containers behind a load balancer, sessions require either sticky sessions (requests from the same user always route to the same container) or a shared session store. Sticky sessions break when a container dies. Shared stores work but add latency to every request — you're making a Redis round-trip before you can even start handling the actual request.

JWT shifts the state from the server to the client. The token contains all the information needed to verify identity; the server just validates the signature. This is a real scalability win, with real trade-offs — which I'll get to.

## The JWT Design

### Access Token + Refresh Token

We went with a dual-token scheme:

- **Access token**: 15-minute expiry, stateless, signed with `jwt.accessSecret`
- **Refresh token**: 7-day expiry, signed with a different `jwt.refreshSecret`

The two tokens have different secrets for a reason: if the access secret leaks, an attacker can forge access tokens, but refresh tokens (which are more powerful, since they can create new access tokens) remain safe. You can rotate the access secret independently.

```typescript
// auth.service.ts
private generateAccessToken(payload: JwtPayload): string {
  const expiresIn = this.configService.get<string>('jwt.accessExpiresIn', '15m')
  return this.jwtService.sign(payload, {
    secret: this.configService.get<string>('jwt.accessSecret'),
    expiresIn,
  })
}

private generateRefreshToken(payload: JwtPayload): string {
  const expiresIn = this.configService.get<string>('jwt.refreshExpiresIn', '7d')
  return this.jwtService.sign(payload, {
    secret: this.configService.get<string>('jwt.refreshSecret'),
    expiresIn,
  })
}
```

The access token carries the full JWT payload: `sub` (user ID), `username`, and `role`. That's all you need for most requests — identity and authorization level, without a database lookup.

### ContestUser: Same System, Different Payload

This is where the design pays off against the original two-auth-systems problem.

Contest users get a JWT too, but with a different payload shape:

```typescript
export interface ContestJwtPayload {
  sub: number      // userId (maps to the main user account)
  contestId: number
  role: 'contest-user'
}
```

The `contestId` is baked into the token. A contest JWT is scoped to a specific contest — you can't use a token from Contest A to access Contest B. The `role: 'contest-user'` tells the Guard what kind of user this is.

Critically: contest users are backed by the same `User` table as regular users. The `ContestUser` entity represents the relationship between a user and a contest (separate password, IP binding, stats). At login time, we verify credentials and produce a contest-scoped JWT. The Guard then enforces contest-specific rules.

This replaces the original dual-middleware setup with a single token format that carries context, and a single Guard that knows what to do with it.

### PBKDF2: The Legacy Compatibility Problem

The password hashing decision was made for me by the existing database.

The original system used `HMAC-SHA256(MD5(password))` with a global fixed HMAC key. No per-user salt. As I noted in the code review post, this is a significant security problem: if the config leaks, every password becomes crackable with a precomputed table.

The obvious fix is bcrypt. Industry standard, well-tested, automatically handles salts, GPU-resistant. But there's a catch: you can't retroactively hash existing passwords with bcrypt without knowing the plaintext. The existing database has 4,000+ user records with the old hash format. If I switch to bcrypt and don't handle the transition, every existing user loses their password.

We solved this with PBKDF2 + a migration strategy:

```typescript
// crypto.util.ts
export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex')
  const hash = pbkdf2Sync(password, salt, 100000, 64, 'sha256').toString('hex')
  return `pbkdf2:${salt}:${hash}`
}

export function verifyPassword(password: string, stored: string): boolean {
  if (stored.startsWith('pbkdf2:')) {
    // New format: PBKDF2-SHA256 with per-user salt
    const [, salt, hash] = stored.split(':')
    const computed = pbkdf2Sync(password, salt, 100000, 64, 'sha256').toString('hex')
    return computed === hash
  }
  // Legacy format: HMAC-SHA256(MD5(password))
  return legacyVerify(password, stored)
}

export function isLegacyPasswordFormat(stored: string): boolean {
  return !stored.startsWith('pbkdf2:')
}
```

And in the login flow:

```typescript
// auth.service.ts
if (!verifyPassword(password, user.passwordHash)) {
  throw new UnauthorizedException('用户名或密码错误')
}

// Silently upgrade legacy hashes on successful login
await this.upgradePasswordIfNeeded(user, password)
```

The first login after the upgrade path goes live: verify with old format, succeed, immediately hash with PBKDF2 and update the record. Next login: verify with PBKDF2. The migration happens transparently, one user at a time, on their first login.

I chose PBKDF2 over bcrypt for this system because PBKDF2 is available in Node's built-in `crypto` module with no extra dependencies. For an OJ platform where CPU is precious and bcrypt's GPU-resistance isn't the primary threat model (the threat is a database dump, not an online brute-force), PBKDF2 with 100,000 iterations is a practical choice. If this were a banking system, bcrypt or Argon2id. For this use case, PBKDF2 is fine.

## Guard Design

### Three Layers

The guard hierarchy is:

1. **`JwtAuthGuard`** — validates the access token, rejects expired or malformed tokens with specific error messages
2. **`ContestAuthGuard`** — validates a contest-scoped JWT, then checks IP binding
3. **`RolesGuard`** — checks the user's role against `@Roles()` decorator requirements

```typescript
// jwt-auth.guard.ts — extends Passport's AuthGuard('jwt')
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  handleRequest<TUser = any>(err: any, user: TUser, info: any): TUser {
    if (info instanceof TokenExpiredError) {
      throw new UnauthorizedException('Token 已过期，请重新登录')
    }
    if (info instanceof JsonWebTokenError) {
      throw new UnauthorizedException('无效的 Token')
    }
    if (err || !user) {
      throw err ?? new UnauthorizedException('未授权')
    }
    return user
  }
}
```

The role system uses a numeric weight: `sa: 0, admin: 1, supervisor: 2, user: 3, contest-user: 4`. `@Roles('admin')` means "weight ≤ 1" — admin and superadmin can access, but regular users cannot. This avoids string comparisons scattered across route handlers.

### `CurrentUser()` Decorator

One pattern I want to highlight: the `@CurrentUser()` parameter decorator.

```typescript
// current-user.decorator.ts
export const CurrentUser = createParamDecorator(
  (data: keyof JwtPayload | undefined, ctx: ExecutionContext): JwtPayload | unknown => {
    const request = ctx.switchToHttp().getRequest()
    const user = request.user as JwtPayload
    return data ? user?.[data] : user
  },
)
```

Usage in a controller:

```typescript
@Get('profile')
@UseGuards(JwtAuthGuard)
getProfile(@CurrentUser() user: JwtPayload): JwtPayload {
  return user
}

// Or extract a specific field:
@Get('my-submissions')
@UseGuards(JwtAuthGuard)
getSubmissions(@CurrentUser('sub') userId: number) {
  return this.submissionService.findByUser(userId)
}
```

This is cleaner than `@Request() req: Request` and then manually casting `req.user`. The decorator makes the intent explicit, and the type is enforced at compile time.

### Why Passport Strategies (And Where We Diverged)

The NestJS documentation points you to Passport strategies as the idiomatic auth approach. We do use them — `JwtAccessStrategy`, `JwtContestStrategy`, `JwtRefreshStrategy` each extend `PassportStrategy`. But the Guards are our own, not raw Passport guards.

The reason: `AuthGuard('jwt')` from `@nestjs/passport` doesn't give you control over the error responses. If a token is expired, you get a generic 401. We wanted to distinguish "token expired" (where the client should refresh) from "invalid token" (where the client should re-login). That distinction matters for frontend UX: an automatic retry with a refresh token vs. showing a login dialog.

`handleRequest()` is the hook that gives us this control. It receives the Passport-validated result and any errors, and we can throw specific exceptions with specific messages before NestJS formats the HTTP response.

## The Trade-Off We Haven't Solved

JWT has a well-known problem: you can't invalidate a token before it expires.

If a user's account is compromised, or an admin wants to force-logout all sessions, or a contest ends and you want to invalidate all contest tokens — you have to wait for the 15-minute access token to expire. In practice, 15 minutes is short enough that this isn't catastrophic, but it's not nothing.

The standard solution is a token blacklist in Redis: on logout or force-invalidation, add the token's `jti` (JWT ID) to a Redis set with the same TTL as the token. On each request, check if the token's `jti` is blacklisted.

Our current implementation doesn't do this. The logout endpoint literally does nothing server-side:

```typescript
// auth.controller.ts
@Post('logout')
@HttpCode(HttpStatus.NO_CONTENT)
logout(): void {
  // TODO: 实现 token 黑名单（Redis）
}
```

This is a deliberate deferral. For Leverage's current threat model (an internal platform, students doing coursework, controlled user population), the risk of not having instant invalidation is low. The operational cost of implementing and maintaining a blacklist — especially getting the TTL/cleanup logic right — is non-trivial. We'll add it when the risk justifies it.

The alternative we considered: very short access tokens (5 minutes) with automatic silent refresh. This reduces the invalidation window at the cost of more refresh token traffic. Not implemented, but it's the next step if 15 minutes feels too long.

Refresh tokens are stored in the database in the current design (though the code as shown does database-less verification — a gap that needs addressing in the next iteration). Database storage means refresh tokens *can* be invalidated: delete the record, the next refresh attempt fails. This is the lever for "log out everywhere" functionality.

The honest summary: we traded instant invalidation for architectural simplicity. For a session-based system, that trade doesn't exist — sessions are always invalidatable. For JWT, you choose your point on the spectrum between stateless simplicity and revocation capability. We chose closer to stateless, with the intention of moving toward revocability as the system matures.

## What Changed in Practice

Before: two separate auth middlewares, sessions with Redis backing, in-memory state that breaks under PM2, passwords that are one config leak from mass compromise.

After: one JWT system, two token types (regular + contest), three Guards with clear separation of concerns, passwords that are per-user salted and migration-safe.

The session setup *worked* for a single-process deployment. It would have needed significant surgery for horizontal scaling. The JWT setup works for horizontal scaling by default and handles the ContestUser use case without code duplication.

The password upgrade happens silently. Users don't notice. The security level goes up every time someone logs in.

These aren't dramatic wins — they're the kind of boring, correct decisions that make a codebase easier to reason about in six months. That's the whole point of a rewrite.
