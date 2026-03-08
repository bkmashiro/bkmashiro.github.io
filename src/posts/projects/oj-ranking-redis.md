---
title: "Why the OJ Leaderboard Froze — and How Redis Sorted Sets Fixed It"
description: "A full-table-scan ranking that blocked the event loop for half a day, and the Redis Sorted Set design that makes it real-time with O(log N) updates."
date: 2026-03-08
readingTime: true
tag:
  - Systems
  - Redis
  - Performance
  - OJ
outline: [2, 3]
---

During a competition on Leverage, the online judge platform I maintain, the leaderboard stopped updating. For about half a day. Students were submitting code, getting verdicts, but their rankings didn't change. We eventually traced it to a 15-minute cron job that had blocked the Node.js event loop so severely that the process became unresponsive.

This post is about what went wrong, why the obvious fixes don't actually fix anything, and the Redis Sorted Set design that replaces the whole cron job with O(log N) real-time updates.

## The Original Design

The ranking system worked like this:

```typescript
// rank.service.ts — simplified
async rebuildSaAndRank(divisionId: number, ids: number[]) {
    // Step 1: Load ALL submissions
    const submissions = await Submission.createQueryBuilder('s')
        .where('s.divisionId = :divisionId', { divisionId })
        .orderBy('s.createdAt', 'ASC')
        .getRawMany()
    
    // Step 2: Compute scores for each user in memory
    const userDatas: Map<UserId, ScoreAggregate>[] = []
    for (const submission of submissions) {
        // ... process each submission, update user score maps
        // This creates a full daily history via cloneDeep
    }
    
    // Step 3: Sort everyone
    const ranked = [...userDatas[0].entries()]
        .sort(([, a], [, b]) => compareScores(a, b))
    
    // Step 4: Write results back — one UPDATE per user
    for (const [userId, scoreAggregate] of ranked) {
        await ContestUser.update({ userId, contestId }, {
            rank: /* computed rank */,
            score: scoreAggregate.score,
        })
    }
}
```

A cron job fired every 15 minutes, checked a `pendingSet` for which contests needed rebuilding, and called this function.

## What Actually Happened

Let's walk through why this blocks.

### The O(N log N) Problem

`Array.sort()` is synchronous JavaScript. On V8, it's TimSort — O(N log N) worst case — and it runs on the main thread without yielding. If you have 10,000 submissions for a large contest:

- 10,000 records × ~200 bytes each ≈ 2MB of raw data from the database
- Multiple `cloneDeep` calls to snapshot daily state
- O(N log N) sort on all users
- N separate `UPDATE` statements, each with their own await cycle

On a competition day, a popular contest might have 50,000 submissions across 300 users. The rebuild could take 30-60 seconds of wall clock time, with the sort itself burning several seconds of pure CPU. During that sort, **no other requests are processed**. Incoming submissions pile up. Student-facing pages time out. The cron job eventually completes, but the next invocation starts immediately and the process never recovers.

### Why `setImmediate` Doesn't Help

A natural instinct: "just yield to the event loop between chunks."

```typescript
// This doesn't really work
function processInChunks(items: User[]) {
    let i = 0
    function next() {
        const chunk = items.slice(i, i + 100)
        // ... process chunk
        i += 100
        if (i < items.length) setImmediate(next)
    }
    setImmediate(next)
}
```

The problem is fundamental: the data is already in memory, and the computation inherently requires seeing all of it to produce a correct ranking. You can't rank person #1 without knowing everyone else's score. Chunking defers CPU work but doesn't change the O(N²) communication cost between chunks if they need to share state, and doesn't fix the N separate database writes.

### Why `worker_threads` Is Treating the Symptom

Moving the computation to a worker thread unblocks the main event loop, which is better. But you still have:
- 10MB+ of data serialized and deserialized across thread boundaries
- N separate database writes (potentially slower if the DB connection pool is saturated)
- A cron job that can fall behind under load
- Rankings that are stale by up to 15 minutes

The ranking is still fundamentally batch — you're just doing the batch somewhere else.

## The Redis Sorted Set Solution

Redis Sorted Sets (`ZSET`) are a data structure where every member has an associated floating-point score. Core operations:

```
ZADD key score member     — O(log N)
ZRANK key member          — O(log N), 0-indexed from lowest
ZREVRANK key member       — O(log N), 0-indexed from highest
ZRANGE key start stop     — O(log N + M) where M is returned members
ZRANGEBYSCORE key min max — O(log N + M)
```

The idea: instead of batch-rebuilding rankings, maintain them incrementally. Every time a submission is judged, update the score in Redis. The ranking is always current.

### Score Encoding

For a typical competitive programming contest, ranking is by:
1. Number of problems solved (more = better)
2. Total penalty time (less = better, tiebreaker)

We need to encode both into a single float. The trick: use the integer part for problems solved, and the fractional part (inverted) for penalty.

```typescript
function encodeScore(problemsSolved: number, penaltyMinutes: number): number {
    // Max penalty in a typical contest: ~1440 minutes (24 hours)
    // We want: more problems = higher score, less penalty = higher score
    const MAX_PENALTY = 100000
    return problemsSolved * MAX_PENALTY + (MAX_PENALTY - penaltyMinutes)
}
```

A user who solved 3 problems with 120 minutes penalty: `3 * 100000 + (100000 - 120) = 399880`  
A user who solved 3 problems with 60 minutes penalty: `3 * 100000 + (100000 - 60) = 399940`  
A user who solved 4 problems: `4 * 100000 + ... ≥ 400000`

`ZREVRANK` (rank by descending score) now gives correct competitive ranking automatically.

### The Update Flow

```typescript
// Called every time a submission is judged AC
async onAccepted(contestId: number, userId: number, penaltyMinutes: number) {
    const key = `ranking:${contestId}`
    
    // Lua script for atomic read-modify-write
    const luaScript = `
        local current = redis.call('ZSCORE', KEYS[1], ARGV[1])
        local solved = 0
        local penalty = 0
        if current then
            -- Decode existing score
            solved = math.floor(tonumber(current) / 100000)
            penalty = 100000 - (tonumber(current) % 100000)
        end
        solved = solved + 1
        penalty = penalty + tonumber(ARGV[2])
        local newScore = solved * 100000 + (100000 - penalty)
        redis.call('ZADD', KEYS[1], newScore, ARGV[1])
        return newScore
    `
    
    await redis.eval(luaScript, 1, key, userId.toString(), penaltyMinutes.toString())
}

// Query ranking
async getRank(contestId: number, userId: number): Promise<number> {
    const rank = await redis.zrevrank(`ranking:${contestId}`, userId.toString())
    return rank !== null ? rank + 1 : -1  // 1-indexed
}

// Get top N
async getTopN(contestId: number, n: number) {
    const members = await redis.zrevrange(`ranking:${contestId}`, 0, n - 1, 'WITHSCORES')
    // parse members and scores...
}
```

The Lua script is important: it makes the read-modify-write atomic. Without it, two concurrent ACs from the same user (possible in rejudge scenarios) could race and produce a wrong score.

### Handling Rejudges

When a submission is rejudged (verdict changes from AC to something else, or vice versa), the score needs to be recalculated. The cleanest approach: when a rejudge completes, recalculate the user's score from scratch from their submission history, then `ZADD` with the corrected score.

This is O(submissions by user), which is bounded and rare (rejudges are exceptional).

## Migration Strategy

We can't flip a switch. There's existing ranking data in MySQL that's been accumulated over months.

**Phase 1 — Dual write**: When a submission is judged, update both MySQL (existing flow) and Redis Sorted Set. The Redis data is not yet served to users. This gives us confidence that the Redis data is correct before relying on it.

**Phase 2 — Backfill**: For existing contests, replay their submission histories to populate the Sorted Sets. This can run offline.

**Phase 3 — Read from Redis**: After validation, switch the ranking query endpoints to read from Redis. MySQL ranking data becomes the backup.

**Phase 4 — Remove cron job**: Once Redis rankings have been stable for a full contest cycle, remove the 15-minute rebuild job.

## What We Gained

The difference is stark:

| | Before | After |
|---|---|---|
| Update latency | Up to 15 minutes | < 1ms |
| Update complexity | O(N log N) + N writes | O(log N) |
| Event loop blocking | Yes, for seconds | No |
| Multi-process safe | No (pendingSet bug) | Yes (Redis is shared) |
| Ranking accuracy | Stale, eventually correct | Always current |

The contest that froze the server had ~50,000 submissions. With Redis Sorted Sets, each of those 50,000 submissions would trigger a single `ZADD` — O(log N), never blocking — instead of triggering a 15-minute timer and then a bulk rebuild.

The half-day freeze doesn't happen because the batch rebuild doesn't exist anymore.
