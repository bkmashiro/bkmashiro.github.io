---
title: "构建生产级代码评测平台：Botzone Neo 技术复盘"
description: "从评测引擎到完整 OJ 平台集成，145+ commits，675 个测试，DDD 架构，多机水平扩展，一夜完成。"
date: 2026-03-10
readingTime: true
tag:
  - Systems
  - NestJS
  - Online Judge
  - TypeScript
  - Architecture
outline: [2, 3]
---

从评测引擎到完整 OJ 平台，145+ commits，675 个测试，从零到可水平扩展，一夜完成。

## 为什么要重写

原有的 Leverage OJ 评测方案是"一个 NestJS controller + 多台评测机 client"的长连接架构，问题很明显：

- 评测机是有状态的长连接 client，故障后无法自动恢复
- 评测任务没有持久化，重启丢任务
- 不支持 Botzone 游戏 AI 对战（只有标准 OJ 评测）
- 前端没有逐测试点结果、Botzone 回放这些功能

这次目标是从头写一个真正生产可用的评测系统，包含：
- **Botzone Neo**：独立的 Judge Service
- **Leverage 后端**：集成 Botzone Neo 作为 Judge Provider
- **Leverage 前端**：评测结果展示 + Botzone 游戏回放

## 整体架构

```
┌─────────────────────────── Server 1 ────────────────────────────┐
│                                                                   │
│  Leverage Frontend  →  Leverage Backend  →  Botzone Neo Worker   │
│                               ↑ callback           │             │
│                               └────────────────────┘             │
│                                           │                       │
│                               Redis (shared queue)                │
└───────────────────────────────────────────────────────────────────┘

┌─────────────────── Server 2..N ──────────────────────────────────┐
│  Botzone Neo Worker (stateless)  ────────────────→  Redis        │
└──────────────────────────────────────────────────────────────────┘
```

核心设计原则：
- **Botzone Neo 完全无状态**：所有任务状态在 Redis，Worker 可随意横向扩容
- **Leverage 负责业务**：权限、持久化、展示；不负责执行评测
- **异步 + Callback**：Leverage 投递任务后立即返回，结果通过 Callback 回写

## Botzone Neo：评测引擎设计

### DDD 分层

```
src/
├── domain/           # 纯业务逻辑，零框架依赖
│   ├── verdict.ts    # AC/WA/TLE/RE/CE/SE 枚举
│   ├── oj/           # OJTask / TestcaseResult / IChecker
│   └── botzone/      # MatchTask / BotOutput / IJob
│
├── infrastructure/   # I/O 适配层
│   ├── compile/      # CompileService：LRU 缓存，多语言
│   ├── sandbox/      # ISandbox：DirectSandbox / NsjailSandbox
│   └── callback/     # CallbackService：重试 + timeout + Request ID
│
├── strategies/       # 可插拔算法
│   ├── botzone/      # Restart / Standard / Checker / Longrun
│   └── oj/           # DiffChecker / CustomChecker
│
├── application/      # Use Case：组合 domain + infrastructure
└── interface/        # HTTP 控制器 + Bull 队列 + DTOs
```

Domain 层没有任何 NestJS import，测试极快，逻辑清晰。

### ISandbox：最关键的抽象

```typescript
export interface ISandbox {
  execute(opts: SandboxExecuteOptions): Promise<SandboxResult>;
}
```

`DirectSandbox`（开发/Mac）直接 `child_process.spawn`，`NsjailSandbox`（生产 Linux）通过 nsjail 包裹进程，cgroups + seccomp + chroot。

切换只需环境变量 `SANDBOX_BACKEND=nsjail|direct`，业务代码零改动。

### Botzone 协议：四种交互模式

Botzone 的核心是裁判程序（judger）通过 stdin/stdout 与 bot 程序通信：

```
Engine → Judger stdin: [当前游戏日志 JSON]
Judger stdout → Engine: {"command":"request","content":{"0":"data-for-bot0"}}
Engine → Bot-0 stdin: "data-for-bot0"
Bot-0 stdout → Engine: {"response":"my-move"}
Engine → Judger stdin: [更新后的游戏日志]
...
Judger stdout → Engine: {"command":"finish","content":{"0":1,"1":0}}
```

四种策略：

| 策略 | Bot 进程生命周期 | 适用场景 |
|------|-----------------|---------|
| `restart` | 每轮重启 | 无状态 bot，最简单 |
| `standard` | 全程持续 | 有状态 bot，每轮收完整日志 |
| `checker` | 全程持续 | Codeforces checker 格式 |
| `longrun` | SIGSTOP/SIGCONT | 需要初始化的 bot，零重启开销 |

### 编译 LRU 缓存

编译是评测中最慢的操作，Botzone 多局对战中同一 bot 要打多场。

```typescript
const key = `${language}:${sha256(source)}`;
if (this.cache.has(key)) {
  this.cacheHits.inc();    // Prometheus counter
  return this.cache.get(key)!;
}
const compiled = await this.doCompile(language, source);
this.cache.set(key, compiled);   // LRU 自动淘汰
return compiled;
```

默认容量 100，同一 bot 代码无论打多少局都只编译一次。

### SSRF 防护

评测引擎需要向用户提供的 callback URL 发请求，不做防护等于给了内网探测工具。

拦截所有常见绕过姿势：

```typescript
const PRIVATE_RANGES = [
  '127.0.0.0/8', '10.0.0.0/8',
  '172.16.0.0/12', '192.168.0.0/16',
  '::1', 'fc00::/7', 'fe80::/10',
  '169.254.0.0/16',
];
// 额外拦截：
// - IPv6 hex bypass:  http://0x7f000001/
// - URL-encoded:      http://%31%32%37.0.0.1/
// - Decimal encoding: http://2130706433/
// - Buffer overflow:  超长 hostname（>253 字节）
```

全部有对应单元测试覆盖。

### Bull 异步队列 + 结果持久化

```
POST /v1/judge  →  Bull.add()  →  return { jobId }
                        │
               Worker Pool  (JUDGE_CONCURRENCY 并发)
                        │ job.returnvalue = result
                        ▼
GET /v1/judge/:id/status  →  { state, result }
```

结果写入 `job.returnvalue`（Redis 持久化），客户端轮询 status 接口即可拿到完整评测结果，无需客户端自己等待 callback。

### 可观测性

```
# Prometheus metrics
botzone_judge_requests_total{type="oj",verdict="AC"} 42
botzone_judge_duration_ms_bucket{type="botzone",le="500"} 38
botzone_compile_cache_hits_total 156
```

每个 HTTP 请求有 `X-Request-ID`，贯穿 pino 结构化日志 + callback 请求头，链路完全可追踪。

## Leverage 后端集成

### JudgeProvider 抽象

```typescript
export interface IJudgeProvider {
  enqueue(params: EnqueueParams): Promise<EnqueueResult>;
  poll(submissionId: number, externalJobId: string): Promise<PollResult>;
  mapCallback(body: unknown): PollResult;
}
```

将来接入其他评测平台只需实现同一接口，Leverage 业务代码不动。

### 数据库扩展（仅追加）

对 `Submission` 表追加三个 nullable 列：

```sql
ALTER TABLE submission ADD COLUMN provider VARCHAR(32) NULL;
ALTER TABLE submission ADD COLUMN externalJobId VARCHAR(128) NULL;
ALTER TABLE submission ADD COLUMN providerMeta TEXT NULL;
```

`providerMeta` 存 JSON，Botzone 对战结果里包含 `gameLog`（每回合数据），供前端回放用。

### Callback 安全

```
botzone-neo  ──POST /botzone/callback──▶  leverage-backend
              Authorization: Bearer <BOTZONE_CALLBACK_TOKEN>
```

三重保障：
1. **Token 验证**：Bearer token 校验，无 token 直接 401
2. **幂等性**：相同 `jobId + state` 只处理一次
3. **补偿轮询**：每 30s 扫描所有 pending 提交，防 callback 丢失

## Leverage 前端集成

### 提交详情页

更新后的 `/submissions/:id`：

- **实时轮询**：pending/judging 时每 3s 拉一次，终态后停止
- **OJ 结果面板**：编译结果 + 逐测试点表格（verdict badge、时间、内存、实际输出展开）
- **Botzone 回放面板**：`provider === 'botzone'` 时自动渲染

### Game Renderer 插件系统

每个游戏可以注册自己的 Vue 组件作为渲染器，没有注册则 fallback 到通用 JSON 视图：

```typescript
// 插件注册
registerRenderer('tictactoe', () => import('./TicTacToe.vue'));

// 根渲染器根据 gameId 动态加载
const loader = rendererRegistry.get(gameLog.gameId);
renderer.value = loader ? await loader() : GenericRenderer;
```

`TicTacToe.vue` 是第一个 game-specific renderer，渲染 3×3 棋盘并展示到当前回合的棋局状态。

### ReplayViewer

回放面板支持：回合步进（上一/下一/首/末局）、自动播放、进度条，以及 judgerDisplay + botOutputs 的折叠展示。末局高亮最终得分。

## 水平扩展

Worker 无状态，扩容只需：

```bash
# 新机器
git clone https://github.com/bkmashiro/botzone-neo
cp deploy/.env.worker.example .env
# 配置 REDIS_HOST=<server1-ip>
docker compose -f deploy/docker-compose.worker.yml up -d
```

并发调优：`JUDGE_CONCURRENCY = CPU 核数 × 2~4`，过高会因 nsjail 内存压力反降吞吐。

Redis 推荐通过 Tailscale 内网暴露给 Worker 节点，不对公网开放。

## 踩的坑

**Bull 并发数是 float**：NestJS `configService.get<number>()` 返回字符串，Bull 不做 parseInt 直接报错"Cannot set Float as concurrency"。修复：显式 `parseInt(..., 10)`。

**job.returnvalue 需要显式 return**：Bull 把 processor 的返回值存为 `returnvalue`，`Promise<void>` + `return;` 退出时 `returnvalue` 是 undefined，前端拿不到结果。函数改成 `Promise<unknown>` 并 `return result` 即可。

**临时目录竞争**：并发评测时每个 testcase 必须用独立工作目录，否则不同评测进程争抢文件。解决：`tc-${id}/` 子目录隔离，评测结束后统一清理父目录。

## 最终成果

| 指标 | 数值 |
|------|------|
| botzone-neo commits | 145 |
| botzone-neo 测试 | 319，覆盖率 92.93% |
| leverage 后端测试 | 675（+79 新增） |
| 新增前端组件 | 8 个 |
| 支持语言 | C++ / Python / TypeScript |
| 评测模式 | OJ / Botzone 对战 |
| 交互策略 | restart / standard / checker / longrun |
| 安全 | SSRF / 限流 / 输入验证 / HMAC callback |
| 可观测性 | Prometheus + pino + Request ID |
| 扩展方式 | Worker 无状态，加机器即扩容 |

**仓库**：
- 评测引擎：[bkmashiro/botzone-neo](https://github.com/bkmashiro/botzone-neo)
- 后端：[ThinkSpiritLab/leverage-backend-neo](https://github.com/ThinkSpiritLab/leverage-backend-neo)
- 前端：[ThinkSpiritLab/leverage-frontend-neo](https://github.com/ThinkSpiritLab/leverage-frontend-neo)

## 后续计划

- **sandlock 替换 nsjail**：自研轻量级沙箱 v1.5.0，安装配置更简单，计划作为默认生产沙箱
- **WASM 沙箱**：WebAssembly runtime 作为 fallback，支持 seccomp 受限环境
- **Botzone ELO 排名**：对战结果接入 ELO 算法，实时排行榜
- **实时对战视角**：从"赛后回放"升级到 SSE/WebSocket 流式推送
