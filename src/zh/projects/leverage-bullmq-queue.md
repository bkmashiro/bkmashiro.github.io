---
title: "从自研队列到 Bull：重新设计评测队列"
description: "原版 Leverage OJ 用自研的 Redis 队列，会静默丢失任务。这篇文章讲评测队列的重新设计——改了什么、为什么改，以及一个让我不得不认真思考的消息投递问题。"
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

提交链路是 Online Judge 的关键路径。用户提交代码，进队列，Worker 取出来，发给评测机，等结果，写回数据库。理论上简单。原版 Leverage 的实现是一个基于 Redis List 的自研队列——问题只在出事的时候才会暴露出来。

这篇文章讲我们为什么要换掉它，换成了什么样，以及一个关于消息投递的边界情况，让我不得不认真思考故障模式。

## 原来的队列

原代码有一个自研的 `Queue<T>` 类，底层用 Redis List 操作：

```typescript
// 原版 queue.ts — 概念上类似这样
class Queue<T> {
  async push(item: T): Promise<void> {
    await this.redis.lpush(this.key, JSON.stringify(item))
  }

  async pop(): Promise<T | null> {
    const result = await this.redis.brpop(this.key, 0) // 阻塞弹出，0=一直等
    if (!result) return null
    return JSON.parse(result[1]) as T
  }
}
```

`LPUSH` 入队，`BRPOP` 阻塞出队。教科书式的 Redis 队列实现。Redis 保证 `BRPOP` 是原子的——每个任务只有一个 Worker 能拿到。理论上，这是一个能用的分布式队列。

理论上。

### 问题出在哪

**没有重试。** Worker 取到一个任务后，如果崩了——网络抖动、OOM kill、未处理异常——任务就消失了。`BRPOP` 返回时就把数据从 List 里删除了。进程在 pop 之后、任务完成之前挂掉，任务就没了。没有可见性：没有失败计数，没有死信队列，没有告警。学生的提交就再也没有结果回来。

**实际上的多进程安全问题。** `BRPOP` 本身是原子的没错，多个 Worker 竞争同一个 Redis List 是可以的——每个任务只会被一个 Worker 取到。问题在于 Worker 之间通过 NestJS 服务层共享了状态。在 PM2 cluster 模式下，这导致了和 `pendingSet` 问题同类的 bug——基于单进程假设的有状态逻辑，在请求生命周期跨进程时就出问题了。

**没有任务生命周期可见性。** 任务卡住了？队列堆积了？这个提交等了多久了？没有任何可观察性。你能看到 Redis key 对应的 List 里有一些数据，但不知道有没有在处理、等了多久、有没有失败过。

**没有优先级。** 所有任务先进先出。比赛途中的实时提交和一道老题的重新评测享受同等待遇。

## 为什么选 Bull

先说一下命名的混乱：`@nestjs/bull` 底层用的是 Bull v4，不是 BullMQ，虽然名字接近。BullMQ 是同一个团队对 Bull 的完全重写，原生 TypeScript，API 不同。项目里两个都装了（`package.json` 里都有），但队列基础设施用的是 `@nestjs/bull` 也就是 Bull v4。

选这个的原因是生态成熟度。`@nestjs/bull` 有稳定的 NestJS 集成，装饰器符合 NestJS 约定（`@Processor`、`@Process`），适配器经过充分测试。BullMQ 的 NestJS 集成（`@nestjs/bullmq`）相对更新，还在演进。对评测这条核心链路，我要用更经得起考验的方案。

概念上的改进无论选哪个都是一样的：Bull 和 BullMQ 都提供完整的任务生命周期、重试、死信队列和可观察性。自研的 Redis List 方案一样都没有。

### 任务生命周期

有了 Bull，一个任务会经历这些状态：

```
waiting → active → completed
                ↘ failed → (重试) → waiting
                         → (达到最大重试次数) → 永久失败
```

Worker 取到任务后，任务进入 `active` 状态，并在 Redis 里持有一个"锁"——一个周期性续期的 key。如果 Worker 崩了，锁过期，Bull 把任务移回 `waiting` 状态等待重试。这是和 `BRPOP` 的根本区别：Worker 取到任务后，任务不会消失。

`bull-board` 提供了一个 Web 仪表盘，可以看到各队列的任务数量、失败原因、重试历史。生产出问题时，能直接看到发生了什么。单凭这一点就值得换。

## 评测链路设计

评测链路有两个队列、两个 Worker，加上 heng-controller 通过 HTTP 回调返回结果。

```
提交 → [judge-tx 队列] → JudgeTxWorker → heng-controller
                                               ↓ (HTTP 回调)
                                        [judge-rx 队列] → JudgeRxWorker → ReceiveService
```

### JudgeTxWorker：发送评测任务

```typescript
// judge-tx.worker.ts
@Processor(JUDGE_TX_QUEUE)
export class JudgeTxWorker {
  @Process()
  async handle(job: Job<JudgeTxPayload>): Promise<void> {
    const { submissionId, task } = job.data

    // Step 1: 生成唯一 judgeId（32 字节随机 hex）
    const judgeId = randomBytes(16).toString('hex')

    // Step 2: Redis SADD 注册 judgeId（防重放）
    await this.redisService.sadd(`judge-ids:${submissionId}`, judgeId)

    // Step 3: 构建请求，注入回调 URL
    const callbackBase = this.configService.get<string>('baseUrl', 'http://localhost:3000')
    const request: CreateJudgeRequest = {
      ...task,
      callbackUrls: {
        update: `${callbackBase}/heng/update/${submissionId}/${judgeId}`,
        finish: `${callbackBase}/heng/finish/${submissionId}/${judgeId}`,
      },
    }

    // Step 4: HMAC 签名 + POST heng-controller
    try {
      await this.hengClient.createJudge(request)
    } catch (err) {
      // 提交失败时清理 judgeId
      await this.redisService.srem(`judge-ids:${submissionId}`, judgeId)
      throw err  // 让 Bull 重试
    }
  }
}
```

几个值得解释的点：

**judgeId 的意义。** 每次向 heng-controller 提交任务，我们都生成一个新的 32 字符 hex ID。这不是 heng-controller 的内部 ID——是我们的。我们在调用 heng-controller 之前生成它，调用之前就存进 Redis。judgeId 编码在回调 URL 里，所以 heng-controller 把结果发回来时，URL 路径里就带着 judgeId。

**HMAC 签名。** `createJudge` 会按照 heng-sign-js 协议添加签名 Header：SHA-256 body hash + HMAC-SHA256 整个请求字符串。这替代了代码审查那篇文章记录的 `rejectUnauthorized: false`——用真正的双向认证取代了禁用 TLS 验证。

**throw 的语义。** 如果 HTTP 调用 heng-controller 失败，我们 throw。Bull 看到 `@Process()` 抛了异常，安排重试。任务从 `active` 回到 `waiting`，下次重试会生成新的 judgeId 再试一次。这就是自研队列所没有的重试行为。

### JudgeRxWorker：接收评测结果

heng-controller 通过 HTTP POST 发回结果：

```
POST /heng/finish/{submissionId}/{judgeId}
POST /heng/update/{submissionId}/{judgeId}
```

Controller 验证请求的 HMAC 签名，然后把任务推入 `judge-rx` 队列：

```typescript
// judge-rx.worker.ts
@Processor(JUDGE_RX_QUEUE)
export class JudgeRxWorker {
  @Process()
  async handle(job: Job<JudgeRxPayload>): Promise<void> {
    const { submissionId, judgeId, type, data } = job.data

    // Step 1: 验证 judgeId 合法性
    const isMember = await this.redisService.sismember(`judge-ids:${submissionId}`, judgeId)
    if (!isMember) {
      this.logger.warn(`Stale judgeId ${judgeId} for submission ${submissionId}, ignoring`)
      return
    }

    // Step 2: 分发处理
    if (type === 'finish') {
      await this.receiveService.receiveResult(submissionId, data as JudgeResult)
      // 处理成功，清理 judgeId
      await this.redisService.srem(`judge-ids:${submissionId}`, judgeId)
    } else {
      await this.receiveService.receiveUpdate(submissionId, data as JudgeStateUpdate)
    }
  }
}
```

### 防重放设计

`judge-ids:{submissionId}` 这个 Redis Set 在做一件微妙的事：防重放保护。

JudgeTxWorker 提交任务时：
```
SADD judge-ids:{submissionId} {judgeId}
```

JudgeRxWorker 收到结果时：
```
SISMEMBER judge-ids:{submissionId} {judgeId}
```

如果返回 false，任务被丢弃。这处理了几种情况：

**来自旧评测的过期结果。** 如果一道题被重新评测（生成了新的 judgeId），旧评测的结果可能还会发来。旧的 judgeId 已经不在 Set 里了（要么在旧结果处理后被删除，要么从未被新的提交注册过），所以被忽略。

**重复回调。** heng-controller 可能发来同一个回调两次（网络重试、heng-controller 崩溃重启）。第二次到达时会发现 judgeId 在第一次处理后已经被从 Set 里删除，直接丢弃。

**未授权的结果。** 随便 POST 到 `/heng/finish/{submissionId}/{任意ID}` 不会通过 SISMEMBER 检查，因为这个 judgeId 没有被真正的 JudgeTxWorker 注册过。HMAC 签名校验是第一道防线，SISMEMBER 检查是第二道。

## 一个真实的边界情况：At-Least-Once 投递

这是需要最认真思考的边界情况：如果 heng-controller 成功回调了，但 JudgeRxWorker 在收到回调*之后*、`receiveResult` 完成*之前*崩溃了，会发生什么？

这就是 at-least-once 投递问题。Bull 保证 at-least-once：任务失败（异常或超时），就重试。这意味着 `receiveResult` 可能对同一个结果被调用多次。

追踪一下实际会发生什么：

1. JudgeTxWorker 提交给 heng，注册 judgeId：`SADD judge-ids:42 abc123`
2. heng-controller 调用 `/heng/finish/42/abc123`
3. HTTP handler 把任务推入 `judge-rx` 队列
4. JudgeRxWorker 取到任务，调用 `receiveResult(42, result)`
5. `receiveResult` 的数据库事务进行到一半...
6. **Worker 崩溃**
7. Bull 看到任务失败，触发重试
8. JudgeRxWorker 再次取到同一个任务
9. `SISMEMBER judge-ids:42 abc123` → 仍然是 true（因为我们在成功后才删除）
10. `receiveResult(42, result)` 再次被调用

`receiveResult` 被调用两次会出问题吗？看看它做了什么：

```typescript
// receiveResult 里的数据库事务
await manager.update(Submission, submissionId, { status: finalStatus, time, memory })
await manager.increment(Problem, { id: submission.problemId }, 'submits', 1)
// ...
```

`manager.increment(..., 'submits', 1)` 不是幂等的。调用两次，提交次数就加了两次。这是一个 bug。

现实的解答是：这个边界情况很少发生，而且 `receiveResult` 包在一个完整的数据库事务里。如果重试时发现提交已经是最终状态（不是 pending），可以提前返回：

```typescript
// 防御性检查
const existing = await manager.findOne(Submission, { where: { id: submissionId } })
if (existing?.status !== Status.Pending) {
  this.logger.warn(`Submission ${submissionId} already finalized, skipping duplicate result`)
  return
}
```

这个检查不是万无一失的（存在 TOCTOU 窗口），但结合数据库事务隔离，能处理实际情况。更严格的解法是让 `receiveResult` 完全幂等——对计数器使用 `INSERT ... ON CONFLICT DO NOTHING` 模式，或者用一个专门的去重存储来跟踪某个 judgeId 是否已处理过。

我们还没有完全解决这个问题。架构是对的，故障模式清楚了，现有的缓解措施让它在生产中出问题的概率极低。但"at-least-once 投递意味着消费者需要幂等"是一个我们需要持续完善的要求。

## 实际改变了什么

提交链路从：没有重试、没有可见性、Worker 崩溃就静默丢失任务的自研 `Queue<T>`——变成了：有重试逻辑、有 Web 仪表盘、有完整任务生命周期跟踪、有明确防重放保护的 Bull 队列。

可以感受到的差别：以前可能静默消失的提交（Worker 崩溃、和 heng-controller 的网络错误），现在自动重试。仪表盘让我能看到队列是否堆积、失败任务的错误信息、每个任务消耗了几次重试。

judge-tx → judge-rx 双队列设计意味着 OJ 服务器不需要在处理用户请求时同步调用 heng-controller。提交接口入队即返回，队列异步处理后续。高负载下，任务在队列里有序积压，而不是在 HTTP handler 里超时。

judgeId + SADD 防重放机制是让我最意外的需要自己构建的部分。我以为消息队列会处理幂等性。它们不会——它们只保证投递。幂等性是消费者的问题，在这里，消费者就是我们自己。

这是真正留下来的教训：用了队列不等于解决了消息处理。用队列意味着你得到了投递保证。至于用这些保证做什么——让处理幂等、处理重复消息、把崩溃场景想清楚——还是你自己的事。
