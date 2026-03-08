---
title: "Rebuilding an Online Judge from Scratch: A Full-Stack Refactor Story"
description: "从零重建 OJ 系统：一次完整的全栈重构记录 — How we replaced six years of technical debt with NestJS, BullMQ, Redis Sorted Sets, Nuxt 4, and 639 tests across three layers."
date: 2026-03-08
readingTime: true
tag:
  - Systems
  - NestJS
  - Vue
  - TypeScript
  - Testing
  - Refactoring
outline: [2, 3]
---

> **语言说明 / Language Note:** This post is bilingual. Each section appears in English first, followed by a 中文摘要 (Chinese summary). Jump to any section that works for you.

Some projects accumulate debt quietly. Leverage OJ was not one of them — it accumulated it loudly, in the form of a ranking system that froze mid-competition, an auth system that broke under PM2 clustering, a leaderboard that scanned the entire submissions table on every request, and a password hashing scheme that was one config leak away from a full credential dump.

This is the story of the complete rewrite: what we replaced, why, and what we learned doing it.

---

## 1. Why We Rewrote Instead of Refactored

### The Technical Debt Inventory

The original Leverage OJ was a fast-moving project built under real constraints. The developers were thoughtful — you could see it in the architecture decisions. But six years of feature additions, midnight fixes, and "works on my machine" patches had stacked into a precarious tower.

A code review surfaced 29 distinct bugs. A few of the worst:

**The PM2 cluster race:** The ranking system used an in-memory `pendingSet` to track which contest divisions needed rebuilds. In PM2 cluster mode, each process had its own `pendingSet`. A submission arriving in Process A would mark a division pending, but the cron job running in Process B had an empty set. Rankings would stop updating mid-competition — silently, with no error.

**The full table scan:** Every ranking rebuild called `rebuildSaAndRank()`, which loaded *all submissions* from the database, sorted them in memory (O(N log N)), and wrote results back with N separate `UPDATE` statements. For a multi-day session with tens of thousands of submissions, this pinned the Node.js event loop for minutes. One blocking operation; every other request stalled.

**The password problem:** The hashing scheme was `HMAC-SHA256(MD5(password))` with a global, fixed HMAC key and no per-user salt. No salt means the entire user table can be cracked with one GPU run if the key leaks. The key was in a config file. In the repo.

**The `chenjingyu` check:**
```typescript
// main.ts — production code
if (process.env.USER !== 'chenjingyu') {
    await initService.init()
}
```
A hardcoded username to skip initialization during local development that made it to production. If the server ever ran as a different user, initialization silently wouldn't happen.

### Why Not Incremental?

Incremental refactoring made sense for most of these issues individually. But the auth system, queue system, and ranking system were deeply entangled. Replacing session-based auth required touching every route. Replacing the queue required rethinking how judger callbacks worked. Replacing the ranking system required the new submission flow to be in place first.

We were also starting with zero tests. Adding tests to the existing codebase was possible, but every test we wrote exposed more coupling to unravel. At some point, the cost of incremental improvement exceeded the cost of a clean rewrite with tests from day one.

> **中文摘要：** 原版 Leverage OJ 积累了大量技术债——PM2 集群下的内存 `pendingSet` 竞争条件导致排行榜停止更新、全表扫描卡死事件循环、无 salt 的密码哈希方案、以及一段带有硬编码用户名的生产代码。由于 auth、队列、排行榜三个系统深度耦合，且原代码库测试数量为零，渐进式重构的成本超过了干净重写的成本。

---

## 2. Backend: The Architecture Upgrade

### NestJS Layered Architecture

The new backend is built on **NestJS** with a clean separation of concerns:

```
Controller (HTTP boundary)
  └── Service (business logic)
        └── Repository / TypeORM (data access)
              └── MariaDB / Redis
```

Each module owns its own slice of the application: `auth`, `problem`, `submission`, `heng`, `receive`, `rank`, `contest`, `course`, `user`, `compete`, `media`, `metrics`, `health`. No cross-module direct database access — modules talk to each other through service interfaces.

The system diagram:

```
┌─────────────────────────────────────────────────────────┐
│                    Nuxt 4 Frontend                       │
└────────────────────────┬────────────────────────────────┘
                         │ HTTP / REST
┌────────────────────────▼────────────────────────────────┐
│                  NestJS Backend                          │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐              │
│  │  auth    │  │ problem  │  │submission│  ...modules   │
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
                              │   Judge Nodes × N  │
                              └────────────────────┘
```

### JWT Dual-Token Auth

Session-based auth was replaced with a **dual-token JWT system**:

- **Access token**: 15 minutes, HS256, stateless. Included in every request header.
- **Refresh token**: 7 days, stored in Redis for revocation. Used only to get a new access token.

The guard stack is declarative:

```typescript
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.Supervisor)
@Post('/problems')
async createProblem(@Body() dto: CreateProblemDto) {
  return this.problemService.create(dto);
}
```

Role weights define the hierarchy (lower = more privileged):

| Role | Weight |
|------|--------|
| `sa` | 0 |
| `admin` | 1 |
| `supervisor` | 2 |
| `user` | 3 |
| `contest-user` | 4 |

`@Roles(Role.Supervisor)` resolves to "weight ≤ 2", so `admin` and `sa` also pass automatically.

The server is now truly stateless for access token validation. Horizontal scaling is just adding containers.

### BullMQ Replaces the Hand-Rolled Queue

The original custom `Queue<T>` class had no retries, no dead-letter queue, no observability. The new system uses **BullMQ** with two queues:

- `judge-tx` — sends submissions to `heng-controller` (HMAC-signed HTTP)
- `judge-rx` — receives callbacks from `heng-controller` (async decoupling)

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

Failed jobs retry with exponential backoff. Failed-beyond-retry jobs land in a dead-letter queue. The `bull-board` dashboard provides real-time visibility. The entire submission pipeline that was previously opaque is now observable.

### Redis Sorted Set Replaces Full Table Scan

This is the most impactful single change. The old ranking algorithm:

1. Load all submissions from DB → sort → rebuild ranking table → N UPDATE statements
2. Complexity: O(N) reads + O(N log N) sort + O(N) writes
3. Triggered by cron + in-memory state that broke under clustering

The new algorithm:

```typescript
// On AC submission — called from ReceiveService
async updateRanking(userId: number, acCount: number, penalty: number) {
  const score = acCount * 1_000_000_000 - penalty;
  await this.redis.zadd('rank:global', score, String(userId));
}

// On rank query — O(log N)
async getUserRank(userId: number): Promise<number> {
  const rank = await this.redis.zrevrank('rank:global', String(userId));
  return rank === null ? -1 : rank + 1;
}

// Top-N leaderboard — O(log N + K)
async getLeaderboard(top: number) {
  return this.redis.zrevrange('rank:global', 0, top - 1, 'WITHSCORES');
}
```

Real-time, always correct, O(log N) per operation. No cron job. No in-memory state. No clustering issues. The same pattern applies to contest rankings and course rankings.

### Test Coverage: 0 → 85%+

The original codebase had exactly zero test files. The new backend has:

| Layer | Count | What it tests |
|-------|-------|---------------|
| Unit | 572 | Service logic, isolated with Jest mocks |
| Integration | 42 | DB + Redis with SQLite + ioredis-mock |
| E2E | 25 | Full HTTP stack with testcontainers |

**Total: 639 tests, ≥85% coverage on critical paths.**

> **中文摘要：** 新后端采用 NestJS 分层架构（Controller → Service → TypeORM → MariaDB），JWT 双 Token（access 15min + refresh 7d，revocable），BullMQ 替换手写队列（支持 retry、dead letter queue、可观测性），Redis Sorted Set 替换全表扫描排行榜（O(log n) vs O(n)）。测试覆盖率从 0 到 85%+：572 单元测试 + 42 集成测试 + 25 E2E 测试。

---

## 3. Frontend: The Nuxt 4 Rewrite

### Why Rewrite the Frontend Too

The old frontend was Vue 2, EOL since December 2023. API calls were scattered across components with no abstraction layer. Authentication tokens expired silently mid-submission. No type safety — everything was `any`.

When the backend API changed, the frontend needed to be updated in so many places that a targeted refactor would touch essentially everything. At that point, starting fresh made more sense.

### Stack Decisions

**Nuxt 4, SPA mode.** An OJ platform has no meaningful use for SSR — nearly every page requires authentication, and search engines don't need to index problem statements behind a login wall. SPA mode gives us Nuxt's project structure, auto-imports, routing, and build tooling, without the hydration complexity.

**Naive UI.** Consistent, complete, plays well with Vue 3 Composition API. The old codebase had mixed Element Plus and Naive UI components — that inconsistency is now gone.

**CodeMirror 6.** The code editor is the most important component in an OJ frontend. We chose CodeMirror 6 over Monaco for bundle size and flexibility. The extension model lets us compose exactly what we need: syntax highlighting for C/C++/Python/Java/TypeScript, vim keybindings, One Dark theme.

```typescript
// components/CodeEditor.vue — simplified
const extensions = computed(() => [
  basicSetup,
  oneDark,
  languageExtension(props.language),
  ...(props.readonly ? [EditorView.editable.of(false)] : []),
])
```

**KaTeX** for math rendering. Problem statements in competitive programming are math-heavy. KaTeX renders synchronously and is dramatically faster than MathJax. We use a Vue directive that runs `renderMathInElement` on `mounted` and `updated`:

```typescript
export const vKatex = {
  mounted: (el: HTMLElement) => renderMathInElement(el, {
    delimiters: [
      { left: '$$', right: '$$', display: true },
      { left: '$',  right: '$',  display: false },
    ],
    throwOnError: false,
  }),
  updated: (el: HTMLElement) => renderMathInElement(el, { /* same opts */ }),
}
```

`throwOnError: false` is essential — a malformed expression in a problem statement should degrade gracefully, not crash the renderer.

### The API Composable Layer

Every API interaction goes through a module-specific composable in `composables/api/`. One composable per backend module:

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

`useApi()` is the single point where auth headers are attached, 401s trigger token refresh, and errors are normalized. Nothing else touches axios directly.

### Four Bugs Playwright Found

Once the pages were built, Playwright E2E tests ran a full user journey: login, browse problems, submit code, check results. Four bugs appeared that had escaped all manual testing.

**Bug 1 — Naive UI component registration:** Components were imported globally in `app.vue` as a blunt instrument. `NSelect` (the language dropdown on the submission form) wasn't in the list. It rendered as an empty `<div>` with no console error. Playwright's assertion on the language selector failed immediately. Fix: `unplugin-vue-components` with the Naive UI resolver.

**Bug 2 — NuxtLayout unmounting on async pages:** Pages with `useAsyncData` caused the layout (navbar, sidebar) to flash: render → disappear → re-appear. The root cause: layout defined at the page level via `definePageMeta` interacts differently with async pages than layout defined in `app.vue`. Fix: move `<NuxtLayout>` to `app.vue`.

**Bug 3 — `imports.dirs` not covering nested composables:** Nuxt auto-imports cover `composables/` but only one level deep by default. `composables/api/` wasn't scanned. Worked in dev (Vite's HMR is forgiving), failed in the built output. Fix:
```typescript
// nuxt.config.ts
imports: {
  dirs: ['composables', 'composables/api']
}
```

**Bug 4 — `axios res.data` double-unwrap:** The `useApi` composable returned `response.data`. The individual API functions also did `return response.data`. For endpoints that returned `{ data: { ... } }` envelopes, the final value was `response.data.data`. Playwright's assertion `submission.status === 'AC'` failed because `submission` was actually `{ data: { status: 'AC' } }`. Fix: one `.data` extraction in `useApi`, zero in the individual composables.

The Playwright suite now runs on every push: **30 E2E tests** covering the full user journey.

> **中文摘要：** 前端从 Bootstrap Vue → Nuxt 4 SPA + Naive UI，关掉 SSR（OJ 不需要 SEO），集成 CodeMirror 6 代码编辑器和 KaTeX 数学渲染。所有 API 调用通过 `composables/api/` 模块封装，单点处理 auth 头和 token 刷新。Playwright E2E 共 30 个测试，发现了 4 个 Bug：Naive UI 组件注册遗漏、NuxtLayout 闪烁、composables 自动导入路径配置错误、axios 双重解包。

---

## 4. Engineering Quality Improvements

### TypeORM Migrations: From `synchronize: true` to Versioned Schema

The original codebase used `synchronize: true` — TypeORM's development convenience that automatically alters the database schema on startup to match entity definitions. In development, fine. In production, a footgun: add a column, change a type, rename a field — and the database is mutated on deploy.

The new system uses migrations exclusively:

```typescript
// data-source.ts
export const AppDataSource = new DataSource({
  type: 'mariadb',
  synchronize: false,  // NEVER in production
  migrations: ['dist/migrations/*.js'],
  migrationsRun: true,
})
```

```bash
# Development workflow
pnpm typeorm migration:generate src/migrations/AddSubmissionIndex
pnpm typeorm migration:run
pnpm typeorm migration:revert  # when something goes wrong
```

Every schema change is now a versioned, reversible migration file committed alongside the feature. Rollback is a command, not a crisis.

### Security Audit: The Permission Matrix

After adding 50+ new endpoints during the rewrite, we audited every route with a permission matrix: a table mapping each endpoint to its expected access level vs. its actual guard configuration.

The matrix found two issues:

**Issue 1 — `rejudge` privilege escalation:** The `POST /submissions/:id/rejudge` endpoint was guarded with `@Roles(Role.Admin)` instead of `@Roles(Role.Supervisor)`. Supervisors couldn't rejudge submissions in their own contests — they'd get a 403. The old code had this accessible to supervisors, and the port to the new guard system got the role wrong.

**Issue 2 — Unguarded FIXME:** A `GET /admin/config/raw` endpoint had a `// FIXME: add auth` comment with no guard whatsoever. It exposed full system configuration — database DSN, JWT secrets, HMAC keys — to anyone who knew the URL. This had been in production for an unknown amount of time.

Both fixed. The permission matrix is now a living document checked against every PR that adds or modifies endpoints.

### Input Validation and Rate Limiting

DTOs were hardened with `class-validator` constraints throughout:

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
  timeLimit: number;  // milliseconds

  @IsInt()
  @Min(16)
  @Max(1024)
  memoryLimit: number;  // MB
}
```

Login rate limiting was added via the `ThrottlerModule`:

```typescript
@UseGuards(ThrottlerGuard)
@Throttle({ default: { limit: 5, ttl: 60_000 } })
@Post('/auth/login')
async login(@Body() dto: LoginDto) { ... }
```

5 attempts per minute per IP. Brute-force resistant without introducing a separate middleware layer.

### Database Index Optimization

Several query patterns in the original code were hitting unindexed columns. The migration audit added:

- Composite index on `(contest_id, user_id)` for contest submission queries
- Index on `submission.created_at` for time-range filtering in course exports
- Index on `user.username` for login lookup (was doing full table scan on every auth request)

> **中文摘要：** 工程质量提升主要包括：TypeORM 从 `synchronize:true` 迁移到版本化可回滚 migrations；安全审计使用权限矩阵，发现 rejudge 权限错配（supervisor 被误设为 admin）和一个无守卫的配置泄露接口；DTO 验证全面加固（`class-validator` MaxLength/MinLength）；登录限速（5次/分钟）；以及多处数据库索引优化。

---

## 5. Three-Layer Test Architecture

### The Testing Stack

The 639 tests are organized in three distinct layers, each testing at a different level of isolation:

```
┌─────────────────────────────────────────────────────────┐
│  E2E Tests (25)                                         │
│  testcontainers: real MariaDB + real Redis              │
│  Full HTTP stack, actual network calls                  │
├─────────────────────────────────────────────────────────┤
│  Integration Tests (42)                                 │
│  SQLite in-memory + ioredis-mock                        │
│  Service layer + DB, no HTTP boundary                   │
├─────────────────────────────────────────────────────────┤
│  Unit Tests (572)                                       │
│  Jest mocks, fully isolated                             │
│  One function, one concern                              │
└─────────────────────────────────────────────────────────┘
```

**Unit tests** use Jest's mock system aggressively. A service that depends on TypeORM repositories and Redis gets mock implementations of both:

```typescript
describe('ReceiveService', () => {
  let service: ReceiveService;
  let submissionRepo: MockRepository<Submission>;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        ReceiveService,
        { provide: getRepositoryToken(Submission), useFactory: mockRepository },
        { provide: 'REDIS', useValue: mockRedis },
      ],
    }).compile();

    service = module.get(ReceiveService);
  });

  it('should update ranking on AC submission', async () => {
    await service.handleFinish({ submissionId: 1, status: 'AC', ... });
    expect(mockRedis.zadd).toHaveBeenCalledWith(
      'rank:global', expect.any(Number), '1'
    );
  });
});
```

**Integration tests** use SQLite in-memory for database testing and `ioredis-mock` for Redis. This catches SQL query correctness and entity relationship behavior without requiring live infrastructure.

**E2E tests** use `testcontainers` to spin up real MariaDB and Redis instances for each test run. The full HTTP stack is tested — middleware, guards, validation pipes, serialization. No mocks in the request path.

### Mocking the Judge

The `heng-controller` is an external dependency. E2E tests mock it with `nock`:

```typescript
// In E2E setup
nock(process.env.HENG_URL)
  .post('/judge')
  .reply(200, { judgeId: 'test-judge-001' });

// Simulate callback from heng-controller
await request(app.getHttpServer())
  .post(`/heng/finish/${submissionId}/test-judge-001`)
  .send({ status: 'AC', time: 42, memory: 1024 })
  .expect(200);
```

This lets E2E tests exercise the complete submission → judging → result flow without requiring a real judge node.

### Performance Baseline with k6

A `k6` performance test script measures submission throughput under load:

```javascript
// k6/submit.js
export default function () {
  const res = http.post(`${BASE_URL}/submissions`, JSON.stringify({
    problemId: 1,
    code: 'int main() { return 0; }',
    language: 'cpp',
  }), { headers: { Authorization: `Bearer ${TOKEN}` } });

  check(res, { 'status 201': r => r.status === 201 });
  sleep(1);
}
```

The target: 50 concurrent users, p95 response time < 200ms. Establishing this baseline now means regressions in the submission path are caught before they reach production.

> **中文摘要：** 三层测试体系：Unit（Jest mock，572个）→ Integration（SQLite + ioredis-mock，42个）→ E2E（testcontainers 真实 MariaDB + Redis，25个）。用 nock mock heng judge 评测回调，使 E2E 可以测试完整的提交→评测→结果链路。k6 性能测试脚本作为提交吞吐量的基准。

---

## 6. Key Decisions and Lessons

### `synchronize: true` Is Only for Prototyping

The temptation to keep `synchronize: true` in production is real — it's convenient, and early on the database schema is changing frequently. But the moment you have real user data, `synchronize: true` is a liability. A renamed entity property causes `ALTER TABLE DROP COLUMN` on your production database.

The right time to switch to migrations is *before* you have data you care about losing. We switched during the rewrite, when we were working against a test database. Moving earlier would have been better.

**Rule:** `synchronize: true` in development only. Everything else — staging, CI, production — uses migrations.

### Security Audits Belong Immediately After Feature Complete

The permission matrix audit found a rejudge privilege regression and an unguarded endpoint that had been sitting in the codebase. Both would have been caught immediately if the audit had happened at the end of each sprint rather than at the end of the entire rewrite.

The cost of an undetected privilege escalation in production is much higher than the cost of running the audit regularly. It's a 30-minute exercise with a spreadsheet.

**Rule:** Run the permission matrix after every sprint that adds or modifies endpoints. Not at the end of the project.

### Retrofitted Tests Are Still Worth Writing

We wrote 639 tests for code that was already written — not test-driven development in the traditional sense. The value was still there: tests caught the rejudge regression before it shipped, tests gave us confidence to refactor the ranking system, and tests documented how each module was supposed to behave.

The ideal is tests first. The real constraint is that you often inherit code without tests, and the choice is between "write tests for existing code" and "ship untested code." The first option is clearly better.

**Rule:** Write tests even if the code already exists. The coverage and the documentation value are worth the effort.

> **中文摘要：** 三条关键教训：1) `synchronize:true` 只用于开发，迁移到 migrations 越早越好；2) 权限审计应在每个 sprint 后立即做，而不是等到项目末尾——我们发现的 rejudge 漏洞和无守卫接口本可以更早发现；3) 追加的测试仍然有价值，即使不是 TDD，639 个测试覆盖了回归保护和文档两重价值。

---

## 7. Where We Are Now

### Production Readiness Checklist

| Item | Status |
|------|--------|
| JWT auth with token revocation | ✅ |
| BullMQ submission queue | ✅ |
| Redis leaderboards | ✅ |
| TypeORM migrations | ✅ |
| PBKDF2 password hashing | ✅ |
| Login rate limiting | ✅ |
| DTO validation throughout | ✅ |
| Permission matrix audited | ✅ |
| Unit + Integration + E2E tests | ✅ |
| Prometheus `/metrics` endpoint | ✅ |
| Health check endpoint | ✅ |
| Database indexes optimized | ✅ |
| **Real heng judge integration** | 🔲 Pending |
| **Production deployment** | 🔲 Pending |

The one remaining piece is connecting a real `heng-controller` instance with real judge nodes. The integration is designed and mocked — `JudgeTxWorker` sends HMAC-signed HTTP requests to the controller URL from config; `HengController` receives callbacks and enqueues them. The contract is defined. Plugging in the real endpoint is configuration, not architecture.

### Next Steps

1. **Connect real heng judge nodes** — configure `HENG_URL`, `HENG_AK`, `HENG_SK`, run the system with real code evaluation
2. **Production deployment** — Docker Compose stack, Nginx reverse proxy, TLS, environment-specific configs
3. **Load test under realistic conditions** — k6 with actual contest-scale traffic (100+ concurrent submissions)
4. **Monitoring** — Grafana dashboards on the Prometheus metrics, alerting on queue depth and error rates

The foundation is solid. The interesting problems from here are operational, not architectural.

> **中文摘要：** 当前生产就绪清单已全部完成，唯一待办项是接入真实的 heng 评测机——集成契约已定义，只需配置 `HENG_URL`/`HENG_AK`/`HENG_SK` 即可。下一步：接入真实评测节点、Docker 生产部署、k6 压测验证、以及基于 Prometheus + Grafana 的监控告警体系。

---

The complete rewrite took longer than a targeted fix would have, but it eliminated entire *categories* of bugs rather than patching them individually. The PM2 clustering issues are architecturally impossible now — the new design is stateless. The full-table-scan leaderboard doesn't exist anymore. The password hashing is correct. The test suite catches regressions before they reach users.

Some codebases earn the rewrite. This one did.

---

*Related posts in this series:*
- [Refactoring a Production OJ: From Tech Debt to Clean Architecture](/posts/projects/leverage-refactor)
- [JWT vs Session: Why We Replaced the Entire Auth System](/posts/projects/leverage-auth-jwt)
- [BullMQ in Production: Replacing a Hand-Rolled Job Queue](/posts/projects/leverage-bullmq-queue)
- [TypeORM Migrations: The Right Way to Evolve a Production Schema](/posts/projects/leverage-typeorm-migrations)
- [Security Audit of a Refactored NestJS App](/posts/projects/leverage-security-audit)
- [Leverage OJ Frontend Rewrite: Nuxt 4 + Naive UI SPA](/posts/projects/leverage-frontend-refactor)
- [Redis Sorted Sets for Real-Time OJ Rankings](/posts/projects/oj-ranking-redis)
