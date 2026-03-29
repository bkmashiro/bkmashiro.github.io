---
title: "OJ 排行榜为何冻结——以及 Redis 有序集合如何解决这个问题"
description: "一个全表扫描排名阻塞了事件循环长达半天，以及用 Redis 有序集合实现 O(log N) 实时更新的设计。"
date: 2026-03-08
readingTime: true
tag:
  - 系统
  - Redis
  - 性能优化
  - OJ
outline: [2, 3]
---

在我维护的 OJ 平台 Leverage 上的一次比赛期间，排行榜停止更新了。停了大约半天。学生在继续提交代码、获得评测结果，但他们的排名没有变化。我们最终追踪到一个 15 分钟的定时任务，它严重阻塞了 Node.js 事件循环，导致进程无响应。

这篇文章讲的是哪里出了问题、为什么最直观的修复实际上没有解决任何问题，以及用 Redis 有序集合替换整个定时任务、实现 O(log N) 实时更新的设计。

## 原始设计

排名系统的工作方式如下：

```typescript
// rank.service.ts — 简化版
async rebuildSaAndRank(divisionId: number, ids: number[]) {
    // 第一步：加载所有提交
    const submissions = await Submission.createQueryBuilder('s')
        .where('s.divisionId = :divisionId', { divisionId })
        .orderBy('s.createdAt', 'ASC')
        .getRawMany()
    
    // 第二步：在内存中为每个用户计算分数
    const userDatas: Map<UserId, ScoreAggregate>[] = []
    for (const submission of submissions) {
        // ... 处理每个提交，更新用户分数 map
        // 通过 cloneDeep 创建完整的每日历史记录
    }
    
    // 第三步：给所有人排序
    const ranked = [...userDatas[0].entries()]
        .sort(([, a], [, b]) => compareScores(a, b))
    
    // 第四步：写回结果 — 每个用户一次 UPDATE
    for (const [userId, scoreAggregate] of ranked) {
        await ContestUser.update({ userId, contestId }, {
            rank: /* 计算出的排名 */,
            score: scoreAggregate.score,
        })
    }
}
```

一个定时任务每 15 分钟触发，检查 `pendingSet` 确定哪些比赛需要重建，并调用这个函数。

## 实际发生了什么

让我们分析为什么它会阻塞。

### O(N log N) 问题

`Array.sort()` 是同步的 JavaScript。在 V8 上，它是 TimSort——最坏情况 O(N log N)——并且在主线程上运行，不会让出控制权。如果大型比赛有 10,000 个提交：

- 10,000 条记录 × ~200 字节 ≈ 来自数据库的 2MB 原始数据
- 多次 `cloneDeep` 调用来快照每日状态
- 对所有用户进行 O(N log N) 排序
- N 条独立的 `UPDATE` 语句，每条都有自己的 await 周期

在比赛日，一场热门比赛可能有 300 个用户的 50,000 个提交。重建可能需要 30-60 秒的实际时间，排序本身就要燃烧几秒纯 CPU。在排序过程中，**没有任何其他请求得到处理**。传入的提交积压，面向学生的页面超时。定时任务最终完成，但下一次调用立即开始，进程再也无法恢复。

### 为什么 `setImmediate` 没有帮助

一个自然的直觉："只要在分块之间让出事件循环就行了。"

```typescript
// 这实际上没用
function processInChunks(items: User[]) {
    let i = 0
    function next() {
        const chunk = items.slice(i, i + 100)
        // ... 处理分块
        i += 100
        if (i < items.length) setImmediate(next)
    }
    setImmediate(next)
}
```

问题是根本性的：数据已经在内存里了，而计算本质上需要看到所有数据才能产生正确的排名。不知道其他所有人的分数，你就无法给第 1 名排名。分块延迟了 CPU 工作，但如果分块之间需要共享状态，并不能改变 O(N²) 的通信代价，也没有修复 N 条独立的数据库写入。

### 为什么 `worker_threads` 只是在治标

把计算移到 Worker 线程解放了主事件循环，这更好。但你仍然有：
- 10MB+ 的数据在线程边界之间序列化和反序列化
- N 条独立的数据库写入（如果 DB 连接池饱和，可能更慢）
- 可能在高负载下落后的定时任务
- 最多延迟 15 分钟的排名

排名在本质上仍然是批处理——你只是在别处做批处理而已。

## Redis 有序集合方案

Redis 有序集合（`ZSET`）是一种数据结构，其中每个成员都有一个关联的浮点分数。核心操作：

```
ZADD key score member     — O(log N)
ZRANK key member          — O(log N)，从最低索引
ZREVRANK key member       — O(log N)，从最高索引
ZRANGE key start stop     — O(log N + M)，M 是返回成员数
```

思路：不再批量重建排名，而是增量维护它。每次提交被评测时，更新 Redis 中的分数。排名始终是最新的。

### 分数编码

对于典型的竞技编程比赛，排名依据：
1. 解决的题目数（多 = 更好）
2. 总罚时（少 = 更好，用作平局决胜）

我们需要把两者编码进一个浮点数。技巧：用整数部分表示解题数，用小数部分（取反）表示罚时。

```typescript
function encodeScore(problemsSolved: number, penaltyMinutes: number): number {
    // 典型比赛的最大罚时：~1440 分钟（24 小时）
    // 我们希望：解题数多 = 分数高，罚时少 = 分数高
    const MAX_PENALTY = 100000
    return problemsSolved * MAX_PENALTY + (MAX_PENALTY - penaltyMinutes)
}
```

解了 3 题、罚时 120 分钟的用户：`3 * 100000 + (100000 - 120) = 399880`
解了 3 题、罚时 60 分钟的用户：`3 * 100000 + (100000 - 60) = 399940`
解了 4 题的用户：`4 * 100000 + ... ≥ 400000`

`ZREVRANK`（按分数降序排名）现在自动给出正确的竞技排名。

### 更新流程

```typescript
// 每次提交通过 AC 时调用
async onAccepted(contestId: number, userId: number, penaltyMinutes: number) {
    const key = `ranking:${contestId}`
    
    // Lua 脚本用于原子读改写
    const luaScript = `
        local current = redis.call('ZSCORE', KEYS[1], ARGV[1])
        local solved = 0
        local penalty = 0
        if current then
            -- 解码现有分数
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

// 查询排名
async getRank(contestId: number, userId: number): Promise<number> {
    const rank = await redis.zrevrank(`ranking:${contestId}`, userId.toString())
    return rank !== null ? rank + 1 : -1  // 从 1 开始索引
}
```

Lua 脚本很重要：它使读改写变成原子操作。没有它，同一用户的两次并发 AC（在重新评测场景中可能发生）可能会竞争并产生错误的分数。

## 迁移策略

我们不能直接切换。MySQL 里有几个月以来积累的排名数据。

**第一阶段——双写**：提交被评测时，同时更新 MySQL（现有流程）和 Redis 有序集合。Redis 数据尚未提供给用户。这让我们在依赖 Redis 数据之前有信心确认它是正确的。

**第二阶段——回填**：对于已有的比赛，重放其提交历史来填充有序集合。可以离线运行。

**第三阶段——从 Redis 读**：验证后，将排名查询接口切换为从 Redis 读取。MySQL 排名数据成为备份。

**第四阶段——移除定时任务**：一旦 Redis 排名在完整的比赛周期中保持稳定，就移除 15 分钟重建任务。

## 我们获得了什么

差异显著：

| | 之前 | 之后 |
|---|---|---|
| 更新延迟 | 最多 15 分钟 | < 1ms |
| 更新复杂度 | O(N log N) + N 次写入 | O(log N) |
| 事件循环阻塞 | 是，持续数秒 | 否 |
| 多进程安全 | 否（pendingSet bug）| 是（Redis 是共享的）|
| 排名准确性 | 过时，最终正确 | 始终最新 |

那场冻结了服务器的比赛有约 50,000 个提交。有了 Redis 有序集合，这 50,000 个提交中的每一个都只会触发一次 `ZADD`——O(log N)，永不阻塞——而不是触发一个 15 分钟的定时器然后进行批量重建。

半天的冻结不再发生，因为批量重建不复存在了。
