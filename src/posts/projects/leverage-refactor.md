---
title: "Refactoring a Production OJ: From Tech Debt to Clean Architecture"
description: "How I systematically tore down years of accumulated technical debt in a NestJS Online Judge platform — and what I learned about how codebases rot."
date: 2026-03-08
readingTime: true
tag:
  - Systems
  - NestJS
  - Refactoring
  - TypeScript
outline: [2, 3]
---

Every codebase has a story. Leverage — the Online Judge platform I've been maintaining — has one too, and it's not pretty. After years of incremental feature additions, quick fixes pushed at midnight, and the occasional "works on my machine" hack making it to production, the codebase had accumulated enough debt to fund a small startup.

The decision to do a full rewrite wasn't made lightly. Rewrites are risky. "The second system effect" is real. But when a code review turns up 29 distinct bugs — including one where *every single AC/WA submission counter is silently wrong* — you start reconsidering.

## Why Refactor? Let Me Count the Ways

### Bug 1: PM2 Cluster Turned a Feature Into a Ghost

The original code used `pendingSet`, an in-memory `Array<Set<number>>`, to track which contest/course divisions needed their rankings rebuilt. A 15-minute cron job would check the set and trigger a rebuild if anything was pending.

On paper, clever. In production with PM2 cluster mode (multiple processes)? A disaster.

When a judger callback came in and a submission was accepted, *Process A* would add a division ID to its local `pendingSet`. But the cron job running in *Process B* had its own separate `pendingSet` — completely empty. The ranking rebuild would never happen. Or it would happen in Process A this one time, but the next batch might land in Process C. It was a race condition with no winners.

This one bug explains why contest rankings would sometimes just... stop updating mid-competition.

### Bug 2: The Scoreboard That Froze

The ranking rebuild logic used `rebuildSaAndRank()`, which would load *all submissions* from the database, sort them in memory with O(N log N), and write results back one row at a time with N separate `UPDATE` statements. For a multi-day practice session with tens of thousands of submissions, this was a blocking operation that would pin the Node.js event loop for minutes.

Node.js is single-threaded. A few hundred milliseconds of CPU work blocks every other request. A minute? The server might as well be down.

### Bug 3: Passwords Without Salt

```typescript
// user.entity.ts — the actual implementation
static hash(password: string): string {
    const md5 = crypto.createHash('md5').update(password).digest('hex')
    return crypto.createHmac('sha256', config.security.hmac).update(md5).digest('hex')
}
```

`HMAC-SHA256(MD5(password))` with a *global, fixed HMAC key*. No per-user salt. This means if the HMAC key leaks — and it's just sitting in a config file — you can precompute a rainbow table and crack every password in the database offline. MD5 is also GPU-accelerable at billions of hashes per second.

### Bug 4: Works on Chenjingyu's Machine

```typescript
// main.ts — I promise I'm not making this up
if (process.env.USER !== 'chenjingyu') {
    await initService.init()
}
```

A production server where initialization behavior depends on the *OS login username*. The developer hardcoded their own username to skip initialization during local development, and it made it to production. If the server ever runs as a different user — or if someone else takes over the project — this silently breaks in ways that are very hard to debug.

## Technical Decisions: What We're Replacing and Why

### JWT vs Session Cookies

The original system used `express-session` with a Redis store. Nothing inherently wrong with this, but it requires session state on the server and gets complicated with horizontal scaling.

We're switching to JWT (access + refresh token pattern):
- Access tokens: 15 minutes, stateless
- Refresh tokens: 7 days, stored in Redis for revocation
- ContestUser auth: JWT payload includes `contestId`, Guards validate device/IP binding

The main advantage isn't performance — it's that the server becomes truly stateless, making Docker-based horizontal scaling trivial.

### BullMQ vs Hand-Rolled Queue

The original code had a custom `Queue<T>` class backed by Redis Lists. It worked, sort of, but lacked retries, dead-letter queues, job priority, and observability. Every edge case had to be handled manually.

BullMQ gives all of this for free, plus a dashboard (`bull-board`), proper TypeScript types, and battle-tested behavior under load. The submission → judger pipeline is critical path — using a proven library here is not optional.

### Redis Sorted Set vs Full Table Scan

This is the most impactful architectural change. Instead of:

1. Load all submissions → sort → rebuild ranking table → write N rows

We do:
1. On AC: `ZADD ranking:{contestId} {score} {userId}` — O(log N)
2. On rank query: `ZREVRANK ranking:{contestId} {userId}` — O(log N)

Real-time, no cron job, no blocking. The ranking is always correct by definition.

### Single Process vs PM2 Cluster

The original PM2 cluster setup was the root cause of the `pendingSet` bug. The "fix" of moving to Redis is correct but doesn't address the fundamental issue: stateful in-memory data has no place in a horizontally-scaled service.

The new design is explicitly single-process (one Docker container per deployment unit). If you need more throughput, you scale with nginx load balancing across multiple containers, each stateless. This is the right mental model for this kind of service.

## Refactor Strategy

### Principle 1: Don't Touch the Database Schema

The production database has real data. Users have submission histories. Changing the schema means a migration, which means a maintenance window, which means coordinating with everyone who uses the platform. We're not doing that.

The new code speaks the same schema. ORM entities are rewritten for clarity, but they map to the same tables and columns.

### Principle 2: Feature Parity, Not Feature Regression

Every API endpoint that exists in the current system must exist in the new system. Routes can change (we're cleaning up the URL structure), but functionality cannot be removed. This is the contract we're making with our users.

### Principle 3: Tests First

The original codebase has exactly zero test files. Zero. Not "low coverage" — literally no `.spec.ts` files anywhere.

For the rewrite, we're targeting ≥80% coverage on critical paths (submission counting, ranking calculation, auth flows) before considering any module "done". This constraint forces us to write testable code — which means better separation of concerns, which is the whole point.

## What I Learned About How Codebases Rot

The original developers weren't bad engineers. I can tell from the code that they were thoughtful people working under constraints. The bugs accumulated through a combination of:

**Pressure to ship**: That `pendingSet` bug existed because the original developer probably had the cron + in-memory approach working in single-process testing. Multi-process was an optimization added later. Nobody wrote a test that ran two processes.

**Config entropy**: The hardcoded username and the config file with secrets checked into git — these are shortcuts that made sense when one person was running this on one server. They become ticking time bombs when the project grows.

**No test harness**: Without tests, every change carries the risk of "did I break something that worked before?" That anxiety leads to *not touching things that work*, even if they're wrong. Technical debt has compound interest.

The lesson isn't "these developers were sloppy." It's that *good practices are load-bearing*. They don't matter when the project is small. They matter enormously when it isn't, and by then it's usually too late to add them without a rewrite.

Which is why we're doing this now.
