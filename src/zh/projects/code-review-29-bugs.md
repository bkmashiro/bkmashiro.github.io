---
title: "从一个 OJ 的 29 条 Bug 学代码审查"
description: "深入解析我在审查一个生产 Online Judge 时发现的 bug——以及它们揭示的代码审查应该怎么做。"
date: 2026-03-08
readingTime: true
tag:
  - Systems
  - Code Review
  - Bug
  - TypeScript
outline: [2, 3]
---

几个月前，我开始认真审查 Leverage——一个在生产运行多年的 NestJS Online Judge 平台。零测试。没有 lint 强制执行。没有正式的审查流程。只有在 deadline 压力下一个功能接一个功能长出来的代码。

最终我整理出了 29 个问题。有些是小的风格问题，有六个是那种让你盯着屏幕半天想"这个……一直在跑？"的 bug。

这篇文章讲的是那六个。

## 审查方法

在深入具体 bug 之前，先说说我的方法论。审查一个大型的、零测试的代码库，靠随机探索是不行的，你会漏掉东西。我用了三个切入点：

**1. 用 commit 历史作为 bug 地图。** 名字是 `fix/issues`、`hotfix/ranking` 这类的分支是金矿。commit message 告诉你开发者*知道*什么出了问题。倒着读那些 diff——fix 之前的代码就是你要在代码库其他地方寻找的东西。

**2. 先分类优先级，再读代码。** 每个发现我都先标 🔴 高 / 🟡 中 / 🟢 低，然后再写描述。这迫使你先问"这真的重要吗？"而不是把报告塞满风格 nit。

**3. 深读 service 层。** 结构良好的 NestJS 应用里，controller 很薄。真正的逻辑在 service 里。核心模块的每个 service 文件我都逐行读了：`ReceiveService`、`RankService`、`SubmissionService`、`UserService`。

## 六个值得说的 Bug

### 1. 那个不存在的 `await`（一切都是错的）

```typescript
// receive.service.ts — 数据库事务内部
async function increment(
    User: typeof AutoTimingEntity,
    Problem: typeof AutoTimingEntity,
    users: UserId,
    problems: ProblemId,
    path: string,
) {
    manager.increment(User, users, path, 1)  // ← 没有 await
    manager.increment(Problem, problems, path, 1)  // ← 没有 await
}
```

这个 `increment` 辅助函数声明了 `async`，调用 `manager.increment(...)` 返回 Promise，但两个调用都没有 `await`。函数在两个 increment 完成之前就返回了。

调用方做的是 `await increment(...)`，这在等 `async` 函数本身执行完毕——但函数已经返回了。数据库 increment 作为游离的 Promise 触发，和事务提交竞速。

事务可能在 increment 运行前就提交了。或者 increment 在连接归还连接池后才跑。结果：AC 计数和提交计数——Online Judge 的核心统计数据——无声地、随机地出错。有时差 1，服务器高负载时可能差更多。

修复是两个 `await` 关键字。影响范围是每一条曾经被评测过的提交。

### 2. 什么都没过滤的过滤器

```typescript
// rank.service.ts — 按学号段过滤学生
const rangeMatch = filtersText.match(/(\d{10})-(\d{10})/)
// ...
for (const e of enrollments) {
    if (rangeMatch && !e.match(rangeMatch[0])) {
        filteredEnrollments.add(e)
    }
}
```

意图：用一个类似 `2021010001-2021019999` 的范围模式过滤学号列表。bug：`rangeMatch` 是 `filtersText.match()` 的结果——是对*整个过滤文本*的匹配对象，不是对某个学号的。`e.match(rangeMatch[0])` 然后把完整范围字符串当作字面子串去匹配每个学号。

结果：范围过滤器什么都没过滤，只是检查了 `"2021010001-2021019999"` 这个字符串有没有逐字出现在学号里。没有。每个范围过滤请求都静默失效。

我发现这个 bug 是因为读代码时问了一句"`rangeMatch[0]` 实际上包含什么？"——是匹配到的字符串，也就是整个范围表达式。修法应该是对 `e`（每个学号）跑正则，而不是对 `filtersText`。

### 3. 每个进程活在自己的宇宙里

```typescript
// receive.service.ts — 修复前
const pendingSet: Array<Set<number>> = [
    new Set<number>(), // Division.Exercise
    new Set<number>(), // Division.Course
    new Set<number>(), // Division.Contest
]

// 评测结果回调时调用
pendingSet[divisionId].add(contestOrCourseId)

// 每 15 分钟 cron job 调用
async refresh() {
    for (let i = 0; i < pendingSet.length; i++) {
        if (pendingSet[i].size > 0) {
            await this.rankService.rebuild(i, [...pendingSet[i]])
            pendingSet[i].clear()
        }
    }
}
```

如果你把"服务器"理解成单个进程，这段代码看起来没问题。用 PM2 cluster 模式（比如 4 个 worker），它以一种在开发环境几乎不可能复现的方式挂了。

进程 A 接到评测机回调，往自己的 `pendingSet` 里加了一条。进程 B 跑 cron job，检查自己的 `pendingSet`——空的。进程 A 的 cron job 跑了，正确地重建了一次排名，然后清空了 set。但如果*下一批*回调落到了进程 B，就进了进程 B 的 set，进程 A 的 cron job 永远看不到它们。

修法是把 `pendingSet` 移进 Redis：

```typescript
// 修复后 — Redis 共享状态
const key = `pending-rank-rebuild:${division}`
await this.redisService.do(e => e.sadd(key, contestOrCourseId))

// refresh() 里：
const ids = await this.redisService.do(e => e.smembers(key))
if (ids.length > 0) {
    await this.redisService.do(e => e.del(key))
    await this.rankService.rebuild(divisionId, ids.map(Number))
}
```

这个 bug 特别隐蔽，因为它本身不是错的——只有在结合特定部署配置时才会出错。

### 4. SSL？什么 SSL？

```typescript
// heng.service.ts
private agent = new https.Agent({
    rejectUnauthorized: false,
})
```

一行代码。所有发往评测机的 HTTPS 请求——接受代码、返回评测结果的那个系统——完全绕过了证书验证。OJ 服务器和评测机之间的中间人可以注入任意评测结果：让任何提交 AC，让任何提交 WA，读取提交的代码。

这种事很容易在开发时做一次（"证书问题以后再修"），然后就永远忘了。它在生产里活了很久。

### 5. 所有密码只被一个 Key 保护

```typescript
static hash(password: string): string {
    const md5 = crypto.createHash('md5').update(password).digest('hex')
    return crypto.createHmac('sha256', config.security.hmac).update(md5).digest('hex')
}
```

没有每用户独立的 salt。`hmac` key 是全局固定的。

这比看起来更糟。MD5 可以用查找表反推。用固定 key 的 HMAC-SHA256 本质上是一个带 key 的哈希——如果你知道 key（攻陷配置文件后就知道了），就可以预计算任意密码的哈希。没有 salt，意味着两个密码相同的用户哈希值完全一样，在破解前就已经泄露了信息。

bcrypt 配合 cost=12 可以解决所有这些问题：自动生成每哈希独立的 salt，设计上抵抗 GPU 加速，有成熟的安全模型。

### 6. 用 `for...in` 遍历数组（JavaScript 经典陷阱）

```typescript
// cache.service.ts
async getHashes(keys: string[]): Promise<Record<string, string>> {
    const cached = await this.redisService.do(e => e.hmget('cache', ...keys))
    const cache: Record<string, string> = {}
    
    for (const k in keys) {  // ← for...in 遍历数组
        if (cached[k] !== null) {
            cache[k] = cached[k]  // k 是 '0', '1', '2'... 而不是 key 字符串
        }
    }
    return cache
}
```

`for...in` 遍历数组给你的是字符串形式的*索引*：`'0'`、`'1'`、`'2'`。代码于是存了 `cache['0'] = cached['0']`——用数字索引作为 key——但调用方期望的缓存以实际字符串 key 索引，比如 `'problem:42'`。

缓存查找永远找不到东西，因为 key 不匹配。缓存静默地永远是空的。每次调用都穿透到 Redis。旁边两处 `@ts-ignore` 注释暗示有人注意到有什么不对，但选择压制类型错误而不是搞清楚原因。

`for...of` 就能修：

```typescript
for (const k of keys) {
    if (cached[keys.indexOf(k)] !== null) {
        cache[k] = cached[keys.indexOf(k)]
    }
}
```

或者更好，用 `.reduce()`，让类型来引导你。

## 我的收获

**缺少 `await` 是 JavaScript 的原罪。** 在一个高度异步、零测试的代码库里，fire-and-forget bug 到处都是。TypeScript 能发现一部分（如果你开了 `no-floating-promises`），但不是全部。每个计数更新都要测试。明确地测试。

**部署拓扑是正确性的一部分。** `pendingSet` bug 只在 PM2 cluster 下存在。代码对它最初写时的部署配置是正确的。配置变了之后，没有测试捕捉到破坏，因为根本没有测试。

**一个 `false` 可以瓦解所有的密码学。** SSL 和密码 bug 都是"看起来正确，但在安全层是错的"。安全属性不会自动组合——你必须显式验证每个假设。

**先读 fix 分支，什么都别做之前。** `fix/issues` 的历史告诉我该往哪里看。每个 hotfix 都是一次坦白："这里坏了，而且我们知道。"这些是你阅读的最高价值目标。

29 个 bug，零测试，多年生产运行。代码运行得"够用"，所以没人注意到大多数这些问题。"生产中能跑"和"是正确的"不是一回事。
