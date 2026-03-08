---
title: "From a Hand-Rolled Queue to Bull: Redesigning the Judge Pipeline"
description: "The original Leverage OJ had a custom Redis queue that silently dropped jobs. Here's the judge pipeline redesign — what changed, why, and the at-least-once delivery problem we had to think carefully about."
date: 2026-03-08
readingTime: true
tag:
  - Systems
  - Redis
  - Queue
  - NestJS
  - OJ
outline: [2, 3]
---

The submission pipeline is the critical path of an Online Judge. A student submits code, it goes into a queue, a worker picks it up, sends it to the judge, waits for results, writes them back. Simple in theory. The original Leverage implementation was a custom queue built on Redis Lists — and it had problems that only showed up when things went sideways.

This post is about why we replaced it, what the replacement looks like, and a specific edge case around message delivery that forced us to think carefully about failure modes.

## The Original Queue

The original code had a custom `Queue<T>` class backed by Redis List operations:

```typescript
// original queue.ts — conceptually similar to this
class Queue<T> {
  constructor(private readonly redis: Redis, private readonly key: string) {}

  async push(item: T): Promise<void> {
    await this.redis.lpush(this.key, JSON.stringify(item))
  }

  async pop(): Promise<T | null> {
    const result = await this.redis.brpop(this.key, 0) // blocking pop, 0 = wait forever
    if (!result) return null
    return JSON.parse(result[1]) as T
  }
}
```

`LPUSH` to enqueue, `BRPOP` to dequeue with blocking wait. This is a textbook Redis queue implementation. Redis guarantees that `BRPOP` is atomic — only one worker gets each item — so in theory, you have a working distributed queue.

In theory.

### The Problems

**No retries.** If the worker received a job and then crashed — network hiccup, OOM kill, unhandled exception — the job was gone. `BRPOP` removes the item from the list when it returns. If your process dies after the pop but before the work completes, the job disappears. There's no visibility into this: no failure counter, no dead-letter queue, no alert. The student's submission just never comes back with a result.

**No multi-process safety in practice.** `BRPOP` is atomic, yes. Multiple workers competing for a single Redis list is actually fine — only one gets each item. The problem was that the workers weren't truly independent: they shared state through the NestJS service layer. In PM2 cluster mode, this led to the same class of bug as the `pendingSet` problem — stateful assumptions that broke when the request lifecycle crossed process boundaries.

**No job lifecycle visibility.** Is a job stuck? Is the queue backed up? How long has this submission been waiting? None of this was observable. You'd look at the Redis key and see a list with some items, but you'd have no idea if something was being processed, how long it had been waiting, or whether it had failed.

**No prioritization.** All jobs were first-in-first-out. A re-judge of an old submission and a live contest submission during a competition got the same treatment.

## Why Bull (Not BullMQ)

I want to address the naming confusion first: `@nestjs/bull` uses Bull v4 under the hood, which is *not* BullMQ despite the similarity. BullMQ is a complete rewrite of Bull by the same team, with native TypeScript and a different API. The project also has BullMQ as a dependency (both are in `package.json`), but the queue infrastructure uses Bull v4 via `@nestjs/bull`.

The reason for this choice comes down to ecosystem maturity at the time of writing. `@nestjs/bull` has stable NestJS integration, decorators that match NestJS conventions (`@Processor`, `@Process`), and a well-tested adapter. BullMQ's NestJS integration (`@nestjs/bullmq`) is newer and still evolving. For the core judge pipeline, I wanted the more battle-tested option.

The conceptual improvement is the same regardless of which you use: Bull/BullMQ both give you a proper job lifecycle, retries, dead-letter queues, and observability. The hand-rolled Redis List approach gives you none of that.

### Job Lifecycle

With Bull, a job moves through states:

```
waiting → active → completed
                ↘ failed → (retry) → waiting
                         → (max retries) → failed permanently
```

When a worker picks up a job, it moves to `active` and is held in a "lock" — a separate Redis key that extends periodically as the job is being processed. If the worker dies, the lock expires, and Bull moves the job back to `waiting` for retry. This is the fundamental difference from `BRPOP`: the job isn't gone when a worker picks it up.

```typescript
// queue.module.ts
@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        redis: {
          host: config.get<string>('redis.host', 'localhost'),
          port: config.get<number>('redis.port', 6379),
        },
      }),
    }),
    BullModule.registerQueue(
      { name: JUDGE_TX_QUEUE },  // 'judge-tx'
      { name: JUDGE_RX_QUEUE },  // 'judge-rx'
    ),
    // Dashboard at /admin/queues
    BullBoardModule.forRoot({
      route: '/admin/queues',
      adapter: ExpressAdapter,
    }),
    BullBoardModule.forFeature(
      { name: JUDGE_TX_QUEUE, adapter: BullAdapter },
      { name: JUDGE_RX_QUEUE, adapter: BullAdapter },
    ),
  ],
  exports: [BullModule],
})
export class QueueModule {}
```

`bull-board` gives you a web dashboard showing job counts, failure reasons, and retry history. This alone is worth the switch — when something breaks in production, you can see exactly what happened.

## The Judge Pipeline

The judge pipeline has two queues and two workers, plus a HTTP callback from heng-controller back to the OJ server.

```
Submission → [judge-tx queue] → JudgeTxWorker → heng-controller
                                                       ↓ (HTTP callback)
                                                [judge-rx queue] → JudgeRxWorker → ReceiveService
```

### JudgeTxWorker: Sending Jobs

```typescript
// judge-tx.worker.ts
@Processor(JUDGE_TX_QUEUE)
export class JudgeTxWorker {
  @Process()
  async handle(job: Job<JudgeTxPayload>): Promise<void> {
    const { submissionId, task } = job.data

    // Step 1: Generate a unique judgeId
    const judgeId = randomBytes(16).toString('hex')

    // Step 2: Register judgeId in Redis (anti-replay)
    await this.redisService.sadd(`judge-ids:${submissionId}`, judgeId)

    // Step 3: Build request with callback URLs
    const callbackBase = this.configService.get<string>('baseUrl', 'http://localhost:3000')
    const request: CreateJudgeRequest = {
      ...task,
      callbackUrls: {
        update: `${callbackBase}/heng/update/${submissionId}/${judgeId}`,
        finish: `${callbackBase}/heng/finish/${submissionId}/${judgeId}`,
      },
    }

    // Step 4: HTTP POST to heng-controller (HMAC-signed)
    try {
      await this.hengClient.createJudge(request)
    } catch (err) {
      // Clean up judgeId if submission failed
      await this.redisService.srem(`judge-ids:${submissionId}`, judgeId)
      throw err  // Let Bull retry
    }
  }
}
```

A few things worth explaining here:

**The judgeId.** Every time we submit a job to heng-controller, we generate a fresh 32-character hex ID. This isn't heng-controller's internal ID — it's ours. We generate it before calling heng-controller and store it in Redis before making the HTTP call. The judgeId is embedded in the callback URLs, so when heng-controller sends results back, it includes the judgeId in the URL path.

**The HMAC signature.** `createJudge` calls `hengClient.createJudge()`, which adds signed headers following the heng-sign-js protocol: SHA-256 body hash + HMAC-SHA256 over the request string. This replaced the original `rejectUnauthorized: false` that I documented in the code review — proper mutual authentication instead of disabled TLS verification.

**The throw.** If the HTTP call to heng-controller fails, we throw. Bull sees an exception from `@Process()` and schedules a retry. The job goes from `active` back to `waiting`, and the next attempt will generate a new judgeId and try again. This is the retry behavior we didn't have with the hand-rolled queue.

### JudgeRxWorker: Receiving Results

heng-controller sends results back via HTTP POST to our callback URLs:

```
POST /heng/finish/{submissionId}/{judgeId}
POST /heng/update/{submissionId}/{judgeId}
```

The controller validates the HMAC signature on incoming requests, then pushes a job onto the `judge-rx` queue:

```typescript
// judge-rx.worker.ts
@Processor(JUDGE_RX_QUEUE)
export class JudgeRxWorker {
  @Process()
  async handle(job: Job<JudgeRxPayload>): Promise<void> {
    const { submissionId, judgeId, type, data } = job.data

    // Step 1: Verify judgeId is legitimate
    const isMember = await this.redisService.sismember(`judge-ids:${submissionId}`, judgeId)
    if (!isMember) {
      this.logger.warn(`Stale judgeId ${judgeId} for submission ${submissionId}, ignoring`)
      return
    }

    // Step 2: Dispatch
    if (type === 'finish') {
      await this.receiveService.receiveResult(submissionId, data as JudgeResult)
      // Clean up judgeId after successful processing
      await this.redisService.srem(`judge-ids:${submissionId}`, judgeId)
    } else {
      await this.receiveService.receiveUpdate(submissionId, data as JudgeStateUpdate)
    }
  }
}
```

### The Anti-Replay Design

The `judge-ids:{submissionId}` Redis Set is doing something subtle: it's implementing anti-replay protection.

When JudgeTxWorker submits a job, it calls:
```
SADD judge-ids:{submissionId} {judgeId}
```

When JudgeRxWorker receives a result, it checks:
```
SISMEMBER judge-ids:{submissionId} {judgeId}
```

If this returns false, the job is rejected. This handles several cases:

**Stale results from old submissions.** If a submission was rejudged (generating a new judgeId), results from the old judging run might still arrive. The old judgeId is no longer in the set (it was removed when the old result was processed, or it was never in the set for the new submission run), so it gets ignored.

**Duplicate callbacks.** heng-controller might send the same callback twice (network retry, heng-controller crash and restart). The second arrival will find that the judgeId was already removed from the set after the first processing, so it gets dropped.

**Unauthorized results.** An arbitrary POST to `/heng/finish/{submissionId}/{someId}` won't pass the SISMEMBER check because the judgeId wasn't registered by a real JudgeTxWorker run. (The HMAC signature check provides the first layer of defense; the SISMEMBER check provides the second.)

## The Real Failure Mode: At-Least-Once Delivery

Here's the edge case that required the most thought: what happens if heng-controller successfully calls back, but the JudgeRxWorker crashes *after* receiving the callback but *before* completing `receiveResult`?

This is the at-least-once delivery problem. Bull guarantees at-least-once: if a job fails (exception or timeout), it retries. This means `receiveResult` might be called more than once for the same result.

Let's trace through what actually happens:

1. JudgeTxWorker submits to heng, registers judgeId: `SADD judge-ids:42 abc123`
2. heng-controller calls `/heng/finish/42/abc123`
3. HTTP handler pushes a job onto `judge-rx` queue
4. JudgeRxWorker picks up the job, calls `receiveResult(42, result)`
5. `receiveResult` is partway through its database transaction...
6. **Worker crashes**
7. Bull sees the job as failed, retries
8. JudgeRxWorker picks up the same job again
9. `SISMEMBER judge-ids:42 abc123` → still true (we removed it at the end, after success)
10. `receiveResult(42, result)` is called again

Will `receiveResult` do the wrong thing if called twice? Let's look at what it does:

```typescript
// The database transaction in receiveResult
await manager.update(Submission, submissionId, { status: finalStatus, time, memory })
await manager.increment(Problem, { id: submission.problemId }, 'submits', 1)
// ...
```

`manager.increment(..., 'submits', 1)` is not idempotent. If called twice, the submit count increments twice. That's a bug.

The pragmatic answer is: this edge case is rare, and `receiveResult` is wrapped in a full database transaction. If the retry detects that the submission is already in a final state (not pending), we can short-circuit:

```typescript
// What a defensive receiveResult would check
const existing = await manager.findOne(Submission, { where: { id: submissionId } })
if (existing?.status !== Status.Pending) {
  this.logger.warn(`Submission ${submissionId} already finalized, skipping duplicate result`)
  return
}
```

This check isn't bulletproof (there's a TOCTOU window), but combined with database transaction isolation, it handles the practical case. The more rigorous solution is to make `receiveResult` fully idempotent — use `INSERT ... ON CONFLICT DO NOTHING` patterns for counters, or track whether a specific judgeId has been processed in a deduplicated store.

We haven't fully solved this yet. The architecture is correct, the failure mode is understood, and the mitigation makes it vanishingly unlikely to cause issues in production. But "at-least-once delivery means idempotent consumers" is a requirement we need to keep working toward.

## What Changed in Practice

The submission pipeline went from: a hand-rolled `Queue<T>` with no retries, no visibility, and silent job loss on worker crash — to: Bull-managed queues with retry logic, a web dashboard, proper job lifecycle tracking, and explicit anti-replay protection.

The observable difference: submissions that previously might just silently vanish (worker crash, network error to heng-controller) now retry automatically. The dashboard lets me see if jobs are backing up, what error messages failed jobs have, and how many retries each job has consumed.

The judge-tx → judge-rx two-queue design means the OJ server isn't trying to do synchronous HTTP calls to heng-controller inline with user requests. The submission endpoint enqueues a job and returns immediately; the queue handles the rest asynchronously. Under load, jobs back up in the queue gracefully instead of timing out in HTTP handlers.

The judgeId / SADD anti-replay mechanism is the piece that surprised me most to have to build. I assumed message queues would handle idempotency. They don't — they only handle delivery guarantees. Idempotency is the consumer's problem, and in this case, the consumer is us.

That's the lesson that sticks: "we're using a queue" doesn't mean "we've solved message handling." It means you've gotten delivery guarantees. What you do with those guarantees — making your processing idempotent, handling duplicates, thinking through crash scenarios — is still your problem.
