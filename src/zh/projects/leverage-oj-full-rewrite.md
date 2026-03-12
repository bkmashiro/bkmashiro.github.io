---
title: "从零重建 Online Judge：一次完整的全栈重构记录"
description: "我们用 NestJS、BullMQ、Redis Sorted Sets、Nuxt 4 和横跨三层的 639 个测试替换了六年的技术债务。"
date: 2026-03-08
readingTime: true
tag:
  - 系统设计
  - NestJS
  - Vue
  - TypeScript
  - 测试
  - 重构
outline: [2, 3]
---

有些项目悄悄地积累债务。Leverage OJ 不是其中之一——它大声地积累，表现为比赛中途冻结的排名系统、在 PM2 集群下崩溃的认证系统、每次请求都扫描整个提交表的排行榜，以及离全量凭证泄露只差一个配置泄漏的密码哈希方案。

这是完整重写的故事：我们替换了什么、为什么，以及在这个过程中学到了什么。

---

## 1. 为什么选择重写而不是重构

### 技术债务清单

原版 Leverage OJ 是一个在真实约束下快速推进的项目。开发者是深思熟虑的——你可以从架构决策中看出来。但六年的功能添加、午夜修复和"在我机器上能跑"的补丁已经堆成了一座摇摇欲坠的塔。

一次代码审查发现了 29 个不同的 bug。其中几个最严重的：

**PM2 集群竞争：** 排名系统使用内存中的 `pendingSet` 来跟踪哪些比赛分组需要重建。在 PM2 集群模式下，每个进程都有自己的 `pendingSet`。到达进程 A 的提交会将一个分组标记为待处理，但在进程 B 中运行的 cron 任务的集合是空的。排名会在比赛中途停止更新——悄无声息，没有错误。

**全表扫描：** 每次排名重建都调用 `rebuildSaAndRank()`，它会从数据库加载*所有提交*，在内存中排序（O(N log N)），然后用 N 条单独的 `UPDATE` 语句写回结果。对于有数万次提交的多日赛程，这会把 Node.js 事件循环卡住好几分钟。一个阻塞操作；所有其他请求都停滞了。

**密码问题：** 哈希方案是 `HMAC-SHA256(MD5(password))`，使用全局固定的 HMAC 密钥，没有每用户的 salt。没有 salt 意味着如果密钥泄漏，整个用户表可以用一次 GPU 运算破解。密钥在配置文件里。在仓库里。

**`chenjingyu` 检查：**
```typescript
// main.ts — 生产代码
if (process.env.USER !== 'chenjingyu') {
    await initService.init()
}
```
一个用于在本地开发时跳过初始化的硬编码用户名，居然进入了生产环境。如果服务器以其他用户身份运行，初始化就会悄悄地不发生。

### 为什么不增量重构？

对于这些问题中的大多数，增量重构是有意义的。但认证系统、队列系统和排名系统深度纠缠。替换基于 session 的认证需要触及每个路由。替换队列需要重新思考评测器回调的工作方式。替换排名系统需要新的提交流程先就位。

我们还从零测试开始。给现有代码库添加测试是可能的，但我们写的每个测试都暴露出更多需要解开的耦合。在某个点上，增量改进的成本超过了从第一天就带测试的干净重写的成本。

---

## 2. 后端：架构升级

### NestJS 分层架构

新后端基于 **NestJS** 构建，关注点清晰分离：

```
Controller (HTTP 边界)
  └── Service (业务逻辑)
        └── Repository / TypeORM (数据访问)
              └── MariaDB / Redis
```

每个模块拥有自己的应用切片：`auth`、`problem`、`submission`、`heng`、`receive`、`rank`、`contest`、`course`、`user`、`compete`、`media`、`metrics`、`health`。没有跨模块的直接数据库访问——模块通过服务接口相互通信。

系统图：

```
┌─────────────────────────────────────────────────────────┐
│                    Nuxt 4 前端                          │
└────────────────────────┬────────────────────────────────┘
                         │ HTTP / REST
┌────────────────────────▼────────────────────────────────┐
│                  NestJS 后端                            │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐              │
│  │  auth    │  │ problem  │  │submission│  ...模块     │
│  └──────────┘  └──────────┘  └──────────┘              │
└──────┬──────────────┬──────────────┬────────────────────┘
       │              │              │
  ┌────▼────┐   ┌─────▼──────┐  ┌───▼──────────┐
  │ MariaDB │   │   Redis    │  │   BullMQ     │
  │  10.11  │   │     7      │  │ judge-tx/rx  │
  └─────────┘   └────────────┘  └──────┬───────┘
                                        │
                              ┌─────────▼──────────┐
                              │  heng-controller   │
                              └─────────┬──────────┘
                                        │ gRPC
                              ┌─────────▼──────────┐
                              │   评测节点 × N      │
                              └────────────────────┘
```

### JWT 双 Token 认证

基于 session 的认证被替换为 **双 token JWT 系统**：

- **访问令牌**：15 分钟，HS256，无状态。包含在每个请求头中。
- **刷新令牌**：7 天，存储在 Redis 中以支持撤销。仅用于获取新的访问令牌。

守卫堆栈是声明式的：

```typescript
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.Supervisor)
@Post('/problems')
async createProblem(@Body() dto: CreateProblemDto) {
  return this.problemService.create(dto);
}
```

角色权重定义层级（越小越有特权）：

| 角色 | 权重 |
|------|------|
| `sa` | 0 |
| `admin` | 1 |
| `supervisor` | 2 |
| `user` | 3 |
| `contest-user` | 4 |

`@Roles(Role.Supervisor)` 解析为"权重 ≤ 2"，所以 `admin` 和 `sa` 也自动通过。

服务器现在对访问令牌验证是真正无状态的。水平扩展只需添加容器。

### BullMQ 替换手写队列

原来的自定义 `Queue<T>` 类没有重试、没有死信队列、没有可观测性。新系统使用 **BullMQ** 和两个队列：

- `judge-tx` — 发送提交到 `heng-controller`（HMAC 签名的 HTTP）
- `judge-rx` — 接收来自 `heng-controller` 的回调（异步解耦）

```typescript
// Judge TX Worker
@Processor('judge-tx')
export class JudgeTxWorker extends WorkerHost {
  async process(job: Job<SubmissionJob>) {
    const { submissionId, code, language, problemId } = job.data;
    
    const signature = this.signRequest({ submissionId, code, language });
    await this.httpService.post(this.hengUrl + '/judge', {
      submissionId, code, language, problemId,
    }, { headers: { 'X-HMAC-Signature': signature } });
  }
}
```

失败的任务以指数退避重试。超过最大重试次数的任务进入死信队列。`bull-board` 仪表板提供实时可见性。以前不透明的整个提交流水线现在可观测了。

### Redis Sorted Set 替换全表扫描

这是影响最大的单项变更。旧排名算法：

1. 从数据库加载所有提交 → 排序 → 重建排名表 → N 条 UPDATE 语句
2. 复杂度：O(N) 读 + O(N log N) 排序 + O(N) 写
3. 由 cron + 在集群下失效的内存状态触发

新算法：

```typescript
// 在 AC 提交时 — 从 ReceiveService 调用
async updateRanking(userId: number, acCount: number, penalty: number) {
  const score = acCount * 1_000_000_000 - penalty;
  await this.redis.zadd('rank:global', score, String(userId));
}

// 查询排名时 — O(log N)
async getUserRank(userId: number): Promise<number> {
  const rank = await this.redis.zrevrank('rank:global', String(userId));
  return rank === null ? -1 : rank + 1;
}

// 前 N 名排行榜 — O(log N + K)
async getLeaderboard(top: number) {
  return this.redis.zrevrange('rank:global', 0, top - 1, 'WITHSCORES');
}
```

实时、永远正确、每次操作 O(log N)。没有 cron 任务。没有内存状态。没有集群问题。同样的模式适用于比赛排名和课程排名。

### 测试覆盖率：0 → 85%+

原代码库恰好有零个测试文件。新后端有：

| 层级 | 数量 | 测试内容 |
|------|------|----------|
| 单元 | 572 | 服务逻辑，用 Jest mock 隔离 |
| 集成 | 42 | 数据库 + Redis，用 SQLite + ioredis-mock |
| E2E | 25 | 完整 HTTP 栈，用 testcontainers |

**总计：639 个测试，关键路径 ≥85% 覆盖率。**

---

## 3. 前端：Nuxt 4 重写

### 为什么也要重写前端

旧前端是 Vue 2，2023 年 12 月已 EOL。API 调用散落在各个组件中，没有抽象层。认证令牌在提交过程中悄悄过期。没有类型安全——一切都是 `any`。

当后端 API 改变时，前端需要在太多地方更新，以至于定向重构实际上会触及几乎所有内容。到那时，从头开始更有意义。

### 技术栈决策

**Nuxt 4，SPA 模式。** OJ 平台没有 SSR 的实际用途——几乎每个页面都需要认证，搜索引擎不需要索引登录墙后面的题目描述。SPA 模式给我们 Nuxt 的项目结构、自动导入、路由和构建工具，而没有 hydration 的复杂性。

**Naive UI。** 一致、完整，与 Vue 3 Composition API 配合良好。旧代码库混用 Element Plus 和 Naive UI 组件——这种不一致现在没有了。

**CodeMirror 6。** 代码编辑器是 OJ 前端最重要的组件。我们选择 CodeMirror 6 而不是 Monaco 是因为打包大小和灵活性。扩展模型让我们可以精确组合所需的内容：C/C++/Python/Java/TypeScript 的语法高亮、vim 键绑定、One Dark 主题。

```typescript
// components/CodeEditor.vue — 简化版
const extensions = computed(() => [
  basicSetup,
  oneDark,
  languageExtension(props.language),
  ...(props.readonly ? [EditorView.editable.of(false)] : []),
])
```

**KaTeX** 用于数学渲染。竞赛编程中的题目描述数学很多。KaTeX 同步渲染，比 MathJax 快得多。我们使用一个 Vue 指令，在 `mounted` 和 `updated` 时运行 `renderMathInElement`：

```typescript
export const vKatex = {
  mounted: (el: HTMLElement) => renderMathInElement(el, {
    delimiters: [
      { left: '$$', right: '$$', display: true },
      { left: '$',  right: '$',  display: false },
    ],
    throwOnError: false,
  }),
  updated: (el: HTMLElement) => renderMathInElement(el, { /* 相同选项 */ }),
}
```

`throwOnError: false` 是必需的——题目描述中格式错误的表达式应该优雅降级，而不是让渲染器崩溃。

### API Composable 层

每个 API 交互都通过 `composables/api/` 中的模块特定 composable 进行。每个后端模块一个 composable：

```typescript
// composables/api/submissions.ts
export function useSubmissionApi() {
  const { request } = useApi()

  return {
    async submit(problemId: number, body: SubmitBody): Promise<Submission> {
      return request({ method: 'POST', url: `/submissions`, data: { problemId, ...body } })
    },
    async getSubmission(id: number): Promise<Submission> {
      return request({ method: 'GET', url: `/submissions/${id}` })
    },
  }
}
```

`useApi()` 是附加认证头、触发 token 刷新和规范化错误的单点。其他任何东西都不直接接触 axios。

### Playwright 发现的四个 Bug

页面构建完成后，Playwright E2E 测试运行了完整的用户旅程：登录、浏览题目、提交代码、检查结果。四个 bug 浮出水面，它们都逃过了所有手动测试。

**Bug 1 — Naive UI 组件注册：** 组件在 `app.vue` 中作为粗暴手段全局导入。`NSelect`（提交表单上的语言下拉框）不在列表中。它渲染成一个空的 `<div>`，没有控制台错误。Playwright 对语言选择器的断言立即失败。修复：带 Naive UI resolver 的 `unplugin-vue-components`。

**Bug 2 — NuxtLayout 在异步页面上卸载：** 有 `useAsyncData` 的页面导致布局（导航栏、侧边栏）闪烁：渲染 → 消失 → 重新出现。根本原因：在页面级别通过 `definePageMeta` 定义的布局与异步页面的交互方式不同于在 `app.vue` 中定义的布局。修复：将 `<NuxtLayout>` 移到 `app.vue`。

**Bug 3 — `imports.dirs` 没有覆盖嵌套 composables：** Nuxt 自动导入默认只覆盖 `composables/` 一层深。`composables/api/` 没有被扫描。在开发中工作（Vite 的 HMR 更宽容），在构建输出中失败。修复：
```typescript
// nuxt.config.ts
imports: {
  dirs: ['composables', 'composables/api']
}
```

**Bug 4 — `axios res.data` 双重解包：** `useApi` composable 返回 `response.data`。单个 API 函数也做 `return response.data`。对于返回 `{ data: { ... } }` 信封的端点，最终值是 `response.data.data`。Playwright 的断言 `submission.status === 'AC'` 失败，因为 `submission` 实际上是 `{ data: { status: 'AC' } }`。修复：在 `useApi` 中做一次 `.data` 提取，在单个 composable 中不做。

Playwright 套件现在在每次推送时运行：**30 个 E2E 测试**覆盖完整的用户旅程。

---

## 4. 工程质量改进

### TypeORM 迁移：从 `synchronize: true` 到版本化 Schema

原代码库使用 `synchronize: true`——TypeORM 的开发便利功能，在启动时自动修改数据库 schema 以匹配实体定义。在开发中还好。在生产中，是个隐患：添加一列、改变类型、重命名字段——数据库在部署时就被修改了。

新系统专门使用迁移：

```typescript
// data-source.ts
export const AppDataSource = new DataSource({
  type: 'mariadb',
  synchronize: false,  // 生产环境永远不要
  migrations: ['dist/migrations/*.js'],
  migrationsRun: true,
})
```

```bash
# 开发工作流
pnpm typeorm migration:generate src/migrations/AddSubmissionIndex
pnpm typeorm migration:run
pnpm typeorm migration:revert  # 出问题时
```

每个 schema 变更现在都是一个版本化、可回滚的迁移文件，与功能一起提交。回滚是一个命令，不是一场危机。

### 安全审计：权限矩阵

在重写期间添加了 50+ 个新端点后，我们用权限矩阵审计了每个路由：一个表格，将每个端点映射到其预期访问级别与实际守卫配置。

矩阵发现了两个问题：

**问题 1 — `rejudge` 权限提升：** `POST /submissions/:id/rejudge` 端点被守卫为 `@Roles(Role.Admin)` 而不是 `@Roles(Role.Supervisor)`。Supervisor 无法重新评测他们自己比赛中的提交——他们会收到 403。旧代码让 supervisor 可以访问，迁移到新守卫系统时角色写错了。

**问题 2 — 无守卫的 FIXME：** 一个 `GET /admin/config/raw` 端点有一个 `// FIXME: add auth` 注释，完全没有守卫。它向任何知道 URL 的人暴露完整的系统配置——数据库 DSN、JWT 密钥、HMAC 密钥。这在生产中存在了未知的时间。

两个都修复了。权限矩阵现在是一个活文档，在每个添加或修改端点的 PR 时检查。

### 输入验证和速率限制

DTO 在全程都用 `class-validator` 约束加固：

```typescript
export class CreateProblemDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title: string;

  @IsString()
  @MinLength(10)
  @MaxLength(50_000)
  description: string;

  @IsInt()
  @Min(100)
  @Max(30_000)
  timeLimit: number;  // 毫秒

  @IsInt()
  @Min(16)
  @Max(1024)
  memoryLimit: number;  // MB
}
```

通过 `ThrottlerModule` 添加了登录速率限制：

```typescript
@UseGuards(ThrottlerGuard)
@Throttle({ default: { limit: 5, ttl: 60_000 } })
@Post('/auth/login')
async login(@Body() dto: LoginDto) { ... }
```

每个 IP 每分钟 5 次尝试。抵抗暴力破解，而不需要引入单独的中间件层。

### 数据库索引优化

原代码中的几个查询模式在无索引列上进行。迁移审计添加了：

- `(contest_id, user_id)` 上的复合索引，用于比赛提交查询
- `submission.created_at` 上的索引，用于课程导出中的时间范围过滤
- `user.username` 上的索引，用于登录查找（之前每次认证请求都在做全表扫描）

---

## 5. 三层测试架构

### 测试栈

639 个测试分为三个不同层次，每层在不同级别的隔离上测试：

```
┌─────────────────────────────────────────────────────────┐
│  E2E 测试 (25)                                          │
│  testcontainers：真实 MariaDB + 真实 Redis              │
│  完整 HTTP 栈，实际网络调用                              │
├─────────────────────────────────────────────────────────┤
│  集成测试 (42)                                          │
│  SQLite 内存 + ioredis-mock                             │
│  服务层 + 数据库，没有 HTTP 边界                         │
├─────────────────────────────────────────────────────────┤
│  单元测试 (572)                                         │
│  Jest mock，完全隔离                                    │
│  一个函数，一个关注点                                    │
└─────────────────────────────────────────────────────────┘
```

**单元测试**大量使用 Jest 的 mock 系统。依赖 TypeORM repository 和 Redis 的服务会获得两者的 mock 实现。

**集成测试**使用 SQLite 内存数据库进行数据库测试，使用 `ioredis-mock` 进行 Redis 测试。这可以捕获 SQL 查询正确性和实体关系行为，而不需要实时基础设施。

**E2E 测试**使用 `testcontainers` 为每次测试运行启动真实的 MariaDB 和 Redis 实例。测试完整的 HTTP 栈——中间件、守卫、验证管道、序列化。请求路径中没有 mock。

### Mock 评测器

`heng-controller` 是外部依赖。E2E 测试用 `nock` mock 它：

```typescript
// E2E 设置中
nock(process.env.HENG_URL)
  .post('/judge')
  .reply(200, { judgeId: 'test-judge-001' });

// 模拟来自 heng-controller 的回调
await request(app.getHttpServer())
  .post(`/heng/finish/${submissionId}/test-judge-001`)
  .send({ status: 'AC', time: 42, memory: 1024 })
  .expect(200);
```

这让 E2E 测试可以执行完整的提交 → 评测 → 结果流程，而不需要真实的评测节点。

### k6 性能基线

一个 `k6` 性能测试脚本测量负载下的提交吞吐量。

目标：50 个并发用户，p95 响应时间 < 200ms。现在建立这个基线意味着提交路径中的回归在到达生产之前就会被捕获。

---

## 6. 关键决策和教训

### `synchronize: true` 只用于原型开发

在生产中保持 `synchronize: true` 的诱惑是真实的——它很方便，而且早期数据库 schema 频繁变化。但一旦你有了不想丢失的真实用户数据，`synchronize: true` 就是一个隐患。重命名实体属性会在生产数据库上导致 `ALTER TABLE DROP COLUMN`。

切换到迁移的正确时机是*在*你有在意丢失的数据*之前*。我们在重写期间切换，当时我们在用测试数据库工作。更早移动会更好。

**规则：** `synchronize: true` 只在开发中使用。其他一切——暂存、CI、生产——使用迁移。

### 安全审计应该在功能完成后立即进行

权限矩阵审计发现了一个 rejudge 权限回归和一个一直坐在代码库中的无守卫端点。如果审计在每个 sprint 结束后而不是在整个重写结束后进行，两者都会立即被捕获。

生产中未检测到的权限提升的成本远高于定期运行审计的成本。这是一个用电子表格进行的 30 分钟练习。

**规则：** 在每个添加或修改端点的 sprint 之后运行权限矩阵。不是在项目结束时。

### 补写的测试仍然值得写

我们为已经写好的代码写了 639 个测试——不是传统意义上的测试驱动开发。价值仍在：测试在发布前捕获了 rejudge 回归，测试给了我们重构排名系统的信心，测试记录了每个模块应该如何表现。

理想是先写测试。现实约束是你经常继承没有测试的代码，选择是"为现有代码写测试"和"发布未测试的代码"之间。第一个选项显然更好。

**规则：** 即使代码已经存在，也要写测试。覆盖率和文档价值值得付出努力。

---

## 7. 我们现在的位置

### 生产就绪清单

| 项目 | 状态 |
|------|------|
| JWT 认证 + token 撤销 | ✅ |
| BullMQ 提交队列 | ✅ |
| Redis 排行榜 | ✅ |
| TypeORM 迁移 | ✅ |
| PBKDF2 密码哈希 | ✅ |
| 登录速率限制 | ✅ |
| 全程 DTO 验证 | ✅ |
| 权限矩阵已审计 | ✅ |
| 单元 + 集成 + E2E 测试 | ✅ |
| Prometheus `/metrics` 端点 | ✅ |
| 健康检查端点 | ✅ |
| 数据库索引已优化 | ✅ |
| 用户 API 密钥系统（`lev_` 前缀） | ✅ |
| **botzone-neo 评测集成** | ✅ |
| **多人对战（N 人）支持** | ✅ |
| **MCP 服务器（13 个工具）** | ✅ |
| **生产部署** | 🔲 待定 |

### 下一步

1. **生产部署** — Nginx 反向代理、TLS、环境特定配置
2. **shimmy 上游 PR** — 提交我们的沙箱改进到 lambda-feedback/shimmy
3. **Sandlock Phase 2** — SandlockBackend 中的 Linux cgroups 内存强制
4. **负载测试** — 用真实比赛规模流量进行 k6 测试

基础是稳固的。从这里开始的有趣问题是运维性的，而不是架构性的。

---

完整重写花费的时间比定向修复要长，但它消除了整个*类别*的 bug，而不是单独修补它们。PM2 集群问题现在在架构上是不可能的——新设计是无状态的。全表扫描排行榜不再存在。密码哈希是正确的。测试套件在 bug 到达用户之前捕获回归。

有些代码库值得重写。这个就是。

---

*本系列相关文章：*
- [重构生产 OJ：从技术债务到干净架构](/zh/projects/leverage-refactor)
- [JWT vs Session：为什么我们替换了整个认证系统](/zh/projects/leverage-auth-jwt)
- [生产中的 BullMQ：替换手写任务队列](/zh/projects/leverage-bullmq-queue)
- [TypeORM 迁移：演进生产 Schema 的正确方式](/zh/projects/leverage-typeorm-migrations)
- [重构 NestJS 应用的安全审计](/zh/projects/leverage-security-audit)
- [Leverage OJ 前端重写：Nuxt 4 + Naive UI SPA](/zh/projects/leverage-frontend-refactor)
- [Redis Sorted Sets 实现实时 OJ 排名](/zh/projects/oj-ranking-redis)
- [构建生产代码评测器：botzone-neo 技术深度解析](/zh/projects/botzone-neo-judge-engine)
- [AI 驱动的游戏设计：用 MCP 构建 Bot 竞技平台](/zh/projects/leverage-ai-game-design)
