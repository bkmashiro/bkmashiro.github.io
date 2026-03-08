---
title: "OJ 排行榜为什么会卡死——以及怎么用 Redis Sorted Set 修好它"
description: "一个全表扫描排行榜把事件循环阻塞了半天，以及 Redis Sorted Set 如何用 O(log N) 实时更新彻底替换掉这个 cron job。"
date: 2026-03-08
readingTime: true
tag:
  - Systems
  - Redis
  - Performance
  - OJ
outline: [2, 3]
---

比赛进行期间，Leverage——我维护的 Online Judge 平台——的排行榜停止更新了。持续了大约半天。学生在提交代码、拿到评测结果，但排名没有变化。最终我们把问题追溯到一个每 15 分钟执行的 cron job，它严重地阻塞了 Node.js 事件循环，导致进程几乎不响应。

这篇文章讲的是哪里出了问题、为什么那些"显而易见"的修法实际上什么都没修好，以及 Redis Sorted Set 方案如何用 O(log N) 实时更新彻底替换掉整个 cron job。

## 原始设计

排名系统是这样工作的：

```typescript
// rank.service.ts — 简化版
async rebuildSaAndRank(divisionId: number, ids: number[]) {
    // 第一步：加载所有提交
    const submissions = await Submission.createQueryBuilder('s')
        .where('s.divisionId = :divisionId', { divisionId })
        .orderBy('s.createdAt', 'ASC')
        .getRawMany()
    
    // 第二步：在内存里计算每个用户的分数
    const userDatas: Map<UserId, ScoreAggregate>[] = []
    for (const submission of submissions) {
        // ... 处理每条提交，更新用户分数 map
        // 用 cloneDeep 创建完整的每日历史快照
    }
    
    // 第三步：给所有人排序
    const ranked = [...userDatas[0].entries()]
        .sort(([, a], [, b]) => compareScores(a, b))
    
    // 第四步：逐条写回——每个用户一条 UPDATE
    for (const [userId, scoreAggregate] of ranked) {
        await ContestUser.update({ userId, contestId }, {
            rank: /* 计算出的排名 */,
            score: scoreAggregate.score,
        })
    }
}
```

一个 cron job 每 15 分钟触发，检查 `pendingSet` 里哪些比赛需要重建，然后调用这个函数。

## 实际发生了什么

我们来分析为什么会阻塞。

### O(N log N) 问题

`Array.sort()` 是同步 JavaScript。在 V8 里是 TimSort——最坏情况 O(N log N)——在主线程上跑，不会让出执行权。如果一场大型比赛有 10000 条提交：

- 10000 条记录 × 每条约 200 字节 ≈ 从数据库拉回 2MB 原始数据
- 多次 `cloneDeep` 调用快照每日状态
- 对所有用户的 O(N log N) 排序
- N 条分开的 `UPDATE` 语句，每条都有自己的 await 周期

比赛日，一场热门比赛可能有 300 个用户的 50000 条提交。重建可能需要 30-60 秒墙上时间，排序本身就会烧掉几秒纯 CPU。**在排序期间，没有其他请求被处理**。进来的提交开始积压，学生端页面超时。cron job 最终跑完了，但下一次调用立刻开始，进程永远缓不过来。

### 为什么 `setImmediate` 没用

一个自然的想法：在处理块之间让出事件循环。

```typescript
// 这个实际上不起作用
function processInChunks(items: User[]) {
    let i = 0
    function next() {
        const chunk = items.slice(i, i + 100)
        // ... 处理这个 chunk
        i += 100
        if (i < items.length) setImmediate(next)
    }
    setImmediate(next)
}
```

问题是根本性的：数据已经在内存里了，而这个计算本质上需要看到所有数据才能产生正确的排名。你无法在不知道其他所有人分数的情况下排出第 1 名。分块延迟了 CPU 工作，但没有改变块间需要共享状态时的 O(N²) 通信代价，也没有解决 N 条分开的数据库写入问题。

### 为什么 `worker_threads` 是治标不治本

把计算移到 worker 线程解放了主事件循环，这更好了。但你还是有：
- 10MB+ 的数据在线程边界序列化和反序列化
- N 条分开的数据库写入（如果 DB 连接池饱和甚至更慢）
- 在高负载下可能落后的 cron job
- 最多延迟 15 分钟的排名

排名在根本上还是批量的——你只是把批量处理挪到别处了。

## Redis Sorted Set 方案

Redis Sorted Set（`ZSET`）是一种数据结构，每个成员都有一个关联的浮点分数。核心操作：

```
ZADD key score member     — O(log N)
ZRANK key member          — O(log N)，从低到高 0 索引
ZREVRANK key member       — O(log N)，从高到低 0 索引
ZRANGE key start stop     — O(log N + M)，M 是返回成员数
ZRANGEBYSCORE key min max — O(log N + M)
```

核心思路：不再批量重建排名，而是增量维护。每次提交被评测后，更新 Redis 里的分数。排名永远是当前的。

### 分数编码

典型算法竞赛的排名规则：
1. 解决题目数（多 = 好）
2. 总罚时（少 = 好，用于打破平局）

我们需要把两者编码成一个浮点数。技巧：用整数部分表示解题数，用小数部分（取反）表示罚时。

```typescript
function encodeScore(problemsSolved: number, penaltyMinutes: number): number {
    // 典型比赛最大罚时约 1440 分钟（24 小时）
    // 我们想要：题数越多 = 分数越高，罚时越少 = 分数越高
    const MAX_PENALTY = 100000
    return problemsSolved * MAX_PENALTY + (MAX_PENALTY - penaltyMinutes)
}
```

解了 3 题、罚时 120 分钟的用户：`3 * 100000 + (100000 - 120) = 399880`  
解了 3 题、罚时 60 分钟的用户：`3 * 100000 + (100000 - 60) = 399940`  
解了 4 题的用户：`4 * 100000 + ... ≥ 400000`

`ZREVRANK`（按降序分数排名）现在自动给出正确的竞赛排名。

### 更新流程

```typescript
// 每次提交被评测为 AC 时调用
async onAccepted(contestId: number, userId: number, penaltyMinutes: number) {
    const key = `ranking:${contestId}`
    
    // Lua 脚本确保原子性的读-改-写
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
    return rank !== null ? rank + 1 : -1  // 1 索引
}

// 获取前 N 名
async getTopN(contestId: number, n: number) {
    const members = await redis.zrevrange(`ranking:${contestId}`, 0, n - 1, 'WITHSCORES')
    // 解析 members 和 scores...
}
```

Lua 脚本很关键：它让读-改-写变成原子操作。没有它，同一用户的两个并发 AC（重测场景下可能发生）会产生竞态，得到错误的分数。

### 处理重测

当提交被重测（评测结果从 AC 变成别的，或者反过来），分数需要重新计算。最清晰的做法：重测完成后，从该用户的提交历史重新计算分数，然后用 `ZADD` 写入正确的分数。

这是 O(该用户的提交数），有界且罕见（重测是例外情况）。

## 迁移策略

不能直接切换。MySQL 里有积累了几个月的现有排名数据。

**阶段一——双写**：提交被评测时，同时更新 MySQL（现有流程）和 Redis Sorted Set。Redis 数据还不提供给用户。这让我们在依赖 Redis 之前确认数据是正确的。

**阶段二——回填**：对现有比赛，回放它们的提交历史来填充 Sorted Set。可以离线运行。

**阶段三——从 Redis 读**：验证通过后，把排名查询端点切换到读 Redis。MySQL 排名数据变成备份。

**阶段四——移除 cron job**：Redis 排名在完整比赛周期内稳定运行后，移除 15 分钟重建任务。

## 我们得到了什么

差异是鲜明的：

| | 之前 | 之后 |
|---|---|---|
| 更新延迟 | 最多 15 分钟 | < 1ms |
| 更新复杂度 | O(N log N) + N 次写入 | O(log N) |
| 事件循环阻塞 | 是，持续数秒 | 否 |
| 多进程安全 | 否（pendingSet bug） | 是（Redis 是共享的） |
| 排名准确性 | 有延迟，最终正确 | 永远是当前值 |

卡住服务器的那场比赛有约 50000 条提交。用 Redis Sorted Set，这 50000 条提交中的每一条都会触发一次 `ZADD`——O(log N)，永不阻塞——而不是触发一个 15 分钟计时器然后来一次批量重建。

半天的卡死不会发生了，因为批量重建本身不存在了。
