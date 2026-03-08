---
title: "Leverage OJ 重构记：从屎山到干净架构"
description: "系统性地铲掉一个运行多年的 NestJS Online Judge 平台的技术债——以及我从中学到的关于代码是如何腐烂的。"
date: 2026-03-08
readingTime: true
tag:
  - Systems
  - NestJS
  - Refactoring
  - TypeScript
outline: [2, 3]
---

每个代码库都有自己的故事。Leverage——我一直在维护的 Online Judge 平台——也有，只是这个故事不太好看。经历了多年的功能叠加、半夜推上去的临时修复、以及偶尔出现的"在我机器上能跑"式 hack 进了生产，这个代码库积累的技术债已经够开一家小公司了。

决定做全量重写不是一时冲动。重写有风险，"第二系统效应"是真实存在的。但当一次代码审查翻出 29 个 bug——包括一个"所有 AC/WA 提交计数都静默出错"的问题——你就会开始重新考虑了。

## 为什么要重构？让我数数

### Bug 1：PM2 Cluster 把功能变成了幽灵

原始代码用 `pendingSet`——一个内存里的 `Array<Set<number>>`——来追踪哪些比赛/课程分区需要重建排名。每 15 分钟跑一次 cron job 检查这个 set，有内容就触发重建。

单独看，逻辑没问题。用 PM2 cluster 多进程部署？灾难。

评测机回调来了，某条提交 AC，*进程 A* 把 divisionId 加入它自己的 `pendingSet`。但跑 cron 的是*进程 B*，它有自己完全独立的 `pendingSet`——空的。排名重建永远不会发生。或者这次恰好在进程 A 里重建了，但下一批可能又落到了进程 C。这是一个没有赢家的竞态条件。

这个 bug 解释了为什么比赛中排行榜有时会突然停止更新。

### Bug 2：会卡死的排行榜

排名重建逻辑用的是 `rebuildSaAndRank()`，会把*所有提交*从数据库全量加载进内存，O(N log N) 排序，然后一行一行地写回去，N 条分开的 `UPDATE` 语句。对于一个运行了多天、有几万条提交的练习场景，这个操作会把 Node.js 事件循环阻塞好几分钟。

Node.js 单线程。几百毫秒的 CPU 密集操作就能阻塞所有其他请求。几分钟？服务器和宕机没什么区别。

### Bug 3：密码没有 Salt

```typescript
// user.entity.ts — 真实代码
static hash(password: string): string {
    const md5 = crypto.createHash('md5').update(password).digest('hex')
    return crypto.createHmac('sha256', config.security.hmac).update(md5).digest('hex')
}
```

`HMAC-SHA256(MD5(password))`，用一个*全局固定的 HMAC key*。没有每用户独立的 salt。这意味着一旦 HMAC key 泄露——它就躺在一个配置文件里——就可以预计算彩虹表，把数据库里所有密码离线全部破解。MD5 在现代 GPU 上可以跑到每秒数十亿次哈希。

### Bug 4：只在 Chenjingyu 的机器上能跑

```typescript
// main.ts — 我没开玩笑
if (process.env.USER !== 'chenjingyu') {
    await initService.init()
}
```

一个生产服务器，初始化行为取决于*操作系统登录用户名*。开发者把自己的用户名硬编码进去用来跳过本地开发时的初始化，然后这段代码进了生产。如果服务器换个用户运行，或者项目换人接手，这个地方会以非常难以调试的方式静默出错。

## 技术选型：换什么，为什么换

### JWT vs Session Cookie

原系统用 `express-session` + Redis store。Session 本身没什么问题，但需要服务端维护状态，水平扩展时会变复杂。

切换到 JWT（access + refresh token 模式）：
- Access token：15 分钟有效期，无状态
- Refresh token：7 天，存 Redis 用于吊销
- ContestUser 认证：JWT payload 带 `contestId`，Guard 内验证设备/IP 绑定

主要优势不是性能——而是服务器变成真正无状态，Docker 水平扩展变得trivial。

### BullMQ vs 自研 Queue

原代码有一个自己写的 `Queue<T>` 类，底层是 Redis List。能用，但没有重试、死信队列、任务优先级、可观测性。每个边缘情况都要手动处理。

BullMQ 把这些全给了你，还附送一个 dashboard（bull-board）、完善的 TypeScript 类型、以及经过大量生产验证的行为。提交→评测这条链路是核心关键路径，用成熟库不是可选项。

### Redis Sorted Set vs 全表扫描

这是影响最大的架构变化。原来的流程：

1. 加载所有提交 → 排序 → 重建排名表 → 写 N 行

新的流程：
1. AC 时：`ZADD ranking:{contestId} {score} {userId}` — O(log N)
2. 查排名时：`ZREVRANK ranking:{contestId} {userId}` — O(log N)

实时更新，不需要 cron job，不阻塞。排名永远是最新的，因为它就是实时维护的。

### 单进程 vs PM2 Cluster

PM2 cluster 是 `pendingSet` bug 的根本原因。把它改成 Redis 是正确的修法，但没有解决根本问题：有状态的内存数据在水平扩展的服务里没有立足之地。

新设计明确是单进程（每个部署单元一个 Docker 容器）。需要更大吞吐量？用 nginx 负载均衡多个无状态容器做水平扩展。这是这类服务正确的心智模型。

## 重构策略

### 原则一：不改数据库 Schema

生产数据库里有真实数据。用户有提交历史。改 schema 意味着迁移，迁移意味着维护窗口，维护窗口意味着要和所有用户协调。我们不做这个。

新代码说同样的 schema 语言。ORM 实体为了清晰而重写，但映射到同样的表和列。

### 原则二：功能对等，不功能倒退

现有系统里的每个 API 端点都必须在新系统里存在。路由可以变（我们在整理 URL 结构），但功能不能删。这是我们对用户立下的契约。

### 原则三：先写测试

原始代码库有恰好零个测试文件。零。不是"覆盖率低"——是字面意义上找不到任何 `.spec.ts`。

重写时，关键路径（提交计数、排名计算、认证流程）的覆盖率目标是 ≥80%，才算这个模块"完成"。这个约束迫使我们写出可测试的代码——意味着更好的关注点分离——而这正是重构的意义所在。

## 我学到的：代码库是怎么腐烂的

原始开发者不是差劲的工程师。从代码里能看出来他们是有想法的人，只是在各种约束下工作。Bug 的积累来自几个共同因素：

**赶着上线的压力**：`pendingSet` bug 的存在，是因为开发者大概在单进程环境里测过这个逻辑，跑通了。多进程是后来加的优化。没人写一个跑两个进程的测试。

**配置熵**：硬编码用户名和配置文件里的密钥——这些快捷方式在一个人跑一台服务器时是合理的。当项目变大，它们变成了定时炸弹。

**没有测试体系**：没有测试，每次改动都带着"我有没有破坏之前能用的东西？"的焦虑。这种焦虑会导致*不去碰那些能用的东西，即使它们是错的*。技术债是有复利的。

结论不是"这些开发者很粗心"。而是*好的实践是承重墙*。项目小的时候不重要。项目变大后非常重要，但那时候往往已经太晚，不重写就加不进去了。

这就是我们现在做这件事的原因。
