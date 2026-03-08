---
title: "29 Bugs From One Code Review: What a Zero-Test NestJS OJ Taught Me"
description: "A deep dive into the bugs I found reviewing a production Online Judge — and what they reveal about how code review should actually work."
date: 2026-03-08
readingTime: true
tag:
  - Systems
  - Code Review
  - Bug
  - TypeScript
outline: [2, 3]
---

A few months ago I started a serious code review of Leverage, a NestJS Online Judge platform that had been running in production for years. No tests. No linter enforcement. No formal review process. Just code that had grown organically, feature by feature, under deadline pressure.

I came out of it with 29 documented issues. Some were minor style things. Six of them were the kind of bugs that make you stare at the screen for a moment and think "how has this been running?"

This post is about those six.

## The Review Process

Before diving into specific bugs, a word on methodology. When reviewing a large, untested codebase, random exploration doesn't work. You'll miss things. I used three entry points:

**1. Commit history as a bug map.** Branches named `fix/issues`, `hotfix/ranking`, and similar are goldmines. The commit messages tell you what the developers *knew* was wrong. Read those diffs backwards — the code before the fix is exactly the kind of code you're looking for elsewhere in the codebase.

**2. Priority triage before reading.** I categorized every finding as 🔴 high / 🟡 medium / 🟢 low before writing descriptions. This forces you to ask "does this actually matter?" rather than filling a report with style nits.

**3. Service layer deep reads.** Controllers are thin in a well-structured NestJS app. The real logic lives in services. I read every service file line by line for the core modules: `ReceiveService`, `RankService`, `SubmissionService`, `UserService`.

## The Six Bugs Worth Talking About

### 1. The `await` That Wasn't There (Everything Is Wrong)

```typescript
// receive.service.ts — inside a database transaction
async function increment(
    User: typeof AutoTimingEntity,
    Problem: typeof AutoTimingEntity,
    users: UserId,
    problems: ProblemId,
    path: string,
) {
    manager.increment(User, users, path, 1)  // ← no await
    manager.increment(Problem, problems, path, 1)  // ← no await
}
```

The `increment` helper is declared `async` and calls `manager.increment(...)`, which returns a Promise. But neither call is `await`ed. The function returns before either increment completes.

The caller then does `await increment(...)`, which awaits the completion of the `async` function itself — but the function has already returned. The database increments fire as unattached Promises, racing against the transaction commit.

The transaction might commit before the increments run. Or they might run after the connection is returned to the pool. The result: AC counts and submit counts — the core statistics of an Online Judge — are silently, randomly wrong. Sometimes by 1. Sometimes more, if the server is under load.

The fix is two `await` keywords. The blast radius is every submission that's ever been judged.

### 2. The Filter That Filtered Nothing

```typescript
// rank.service.ts — filtering students by ID range
const rangeMatch = filtersText.match(/(\d{10})-(\d{10})/)
// ...
for (const e of enrollments) {
    if (rangeMatch && !e.match(rangeMatch[0])) {
        filteredEnrollments.add(e)
    }
}
```

The intent: filter a list of student enrollment numbers by a range pattern like `2021010001-2021019999`. The bug: `rangeMatch` is the result of `filtersText.match()` — it's the match object from the *entire filter text*, not from the individual enrollment number. `e.match(rangeMatch[0])` then tries to match the full range string against each enrollment number as a literal substring.

The result: the range filter does nothing except check if the range string `"2021010001-2021019999"` appears verbatim inside an enrollment number. It doesn't. Every range filter silently fails to filter anything.

I found this by reading the code and asking "what does `rangeMatch[0]` actually contain?" It's the matched string, which is the entire range expression. The fix should run the match against `e` (each enrollment), not `filtersText`.

### 3. Each Process Lives in Its Own Universe

```typescript
// receive.service.ts — before the fix
const pendingSet: Array<Set<number>> = [
    new Set<number>(), // Division.Exercise
    new Set<number>(), // Division.Course
    new Set<number>(), // Division.Contest
]

// Called when a submission result arrives
pendingSet[divisionId].add(contestOrCourseId)

// Called every 15 minutes by a cron job
async refresh() {
    for (let i = 0; i < pendingSet.length; i++) {
        if (pendingSet[i].size > 0) {
            await this.rankService.rebuild(i, [...pendingSet[i]])
            pendingSet[i].clear()
        }
    }
}
```

This looks fine if you think of "the server" as a single process. With PM2 cluster mode (4 workers, say), it's broken in a way that's almost impossible to reproduce in development.

Process A receives a judger callback and adds to its `pendingSet`. Process B runs the cron job and checks its own `pendingSet` — empty. Process A's cron job runs and correctly rebuilds the ranking — once — then clears the set. But if Process B receives the *next* batch of callbacks, they go into Process B's set, and Process A's cron job will never see them.

The fix is moving `pendingSet` to Redis:

```typescript
// After fix — Redis-backed shared state
const key = `pending-rank-rebuild:${division}`
await this.redisService.do(e => e.sadd(key, contestOrCourseId))

// In refresh():
const ids = await this.redisService.do(e => e.smembers(key))
if (ids.length > 0) {
    await this.redisService.do(e => e.del(key))
    await this.rankService.rebuild(divisionId, ids.map(Number))
}
```

This bug is particularly sneaky because it's not wrong in isolation — it's only wrong when combined with the deployment configuration.

### 4. SSL? What SSL?

```typescript
// heng.service.ts
private agent = new https.Agent({
    rejectUnauthorized: false,
})
```

One line. All HTTPS requests to the judger infrastructure — the system that accepts code and returns verdicts — bypass certificate validation entirely. A man-in-the-middle between the OJ server and the judger could inject arbitrary judge results: accept any submission, fail any submission, read submitted code.

This is the kind of thing that's easy to do once during development ("I'll fix the cert issue later") and easy to forget forever. It survived in production.

### 5. All Your Passwords Belong to One Key

```typescript
static hash(password: string): string {
    const md5 = crypto.createHash('md5').update(password).digest('hex')
    return crypto.createHmac('sha256', config.security.hmac).update(md5).digest('hex')
}
```

No per-user salt. The `hmac` key is global and static. 

This is worse than it looks. MD5 is reversible via lookup tables. HMAC-SHA256 with a fixed key is essentially a keyed hash — if you know the key (which an attacker would after compromising the config), you can precompute hashes for any password. Since there's no salt, two users with the same password have identical hashes, which leaks information even before cracking.

bcrypt with a cost factor of 12 would solve all of this: automatically generates per-hash salts, is GPU-resistant by design, and has a well-understood security model.

### 6. `for...in` Over an Array (Classic JavaScript Footgun)

```typescript
// cache.service.ts
async getHashes(keys: string[]): Promise<Record<string, string>> {
    const cached = await this.redisService.do(e => e.hmget('cache', ...keys))
    const cache: Record<string, string> = {}
    
    for (const k in keys) {  // ← for...in over an array
        if (cached[k] !== null) {
            cache[k] = cached[k]  // k is '0', '1', '2'... not the key string
        }
    }
    return cache
}
```

`for...in` on an array gives you the *indices* as strings: `'0'`, `'1'`, `'2'`. The code then stores `cache['0'] = cached['0']` — using numeric indices as keys — but callers expect the cache to be keyed by the actual string keys like `'problem:42'`.

The cache lookup never finds anything because the keys don't match. The cache is silently always empty. Every subsequent call goes to Redis instead of the in-memory cache. Two `@ts-ignore` comments nearby suggest someone noticed something was wrong but chose to suppress the type error rather than understand it.

`for...of` would fix this:

```typescript
for (const k of keys) {
    if (cached[keys.indexOf(k)] !== null) {
        cache[k] = cached[keys.indexOf(k)]
    }
}
```

Or better, use `.reduce()` and let the types guide you.

## What I Took Away

**Missing `await` is the JavaScript original sin.** In a heavily async codebase with no tests, fire-and-forget bugs are everywhere. TypeScript catches some of them (if you have `no-floating-promises` enabled), but not all. Test every counter update. Explicitly.

**Deployment topology is part of correctness.** The `pendingSet` bug only exists because of PM2 cluster. The code was correct for the deployment configuration it was originally written for. When the configuration changed, no tests caught the breakage because there were no tests.

**One `false` can undo all your crypto.** The SSL and password bugs are both cases of "correct-looking code that's wrong at the security layer." Security properties don't compose automatically — you have to explicitly verify each assumption.

**Read the fix branches before anything else.** The history of `fix/issues` told me exactly where to look. Every hotfix is a confession: "this was broken, and we knew it." Those are your highest-value reading targets.

Twenty-nine bugs, zero tests, years of production use. The code worked well enough that nobody noticed most of these. "Works in production" and "is correct" are not the same thing.
