---
title: "JWT vs Session：为什么我们替换了整个认证体系"
description: "Leverage OJ 的 Session 认证有三个根本问题。这篇文章讲清楚 JWT 替换方案背后的设计决策——包括我们做的权衡，以及暂时搁置的问题。"
date: 2026-03-08
readingTime: true
tag:
  - Systems
  - NestJS
  - Auth
  - JWT
  - Security
outline: [2, 3]
---

认证这件事，感觉上早就被解决了——直到你接手一个其实没解决好的代码库。开始重写 Leverage OJ 的时候，我发现认证系统其实是三个问题穿了一件外套：一个在 PM2 下会出问题的 Session 配置、一个演变成独立平行宇宙的 ContestUser 认证体系、以及一套差一次配置泄露就会全库密码暴露的哈希方案。

这些问题都不是一眼能看出来的。系统在*运行*——用户可以登录，Session 能持久化，比赛能正常进行。但"能运行"和"正确"是两回事，看得越仔细，就越能看到一个基于不再成立的假设运转的系统。

## Session 哪里出了问题

### PM2 Cluster 打碎了内存状态

原系统用 `express-session` 加 Redis store——标准配置。问题是，它不完全是标准的。

Redis store 在理论上能正确处理 Session 持久化：Session 存在 Redis 里，任何进程都能读。但原代码里积累了很多*和* Session store 并存的内存状态。排行榜重建用的 `pendingSet` 是最典型的例子（在代码审查那篇文章里详细分析过），但认证模块也有自己的版本：设备绑定检查把内存状态和 Session 数据混在一起，这在单进程下是对的，但一旦请求链的生命周期分散到多个进程就会出问题。

PM2 cluster 模式用轮询把请求分配给不同 worker。如果你的认证逻辑碰到了和 Session store 不同的内存状态——哪怕只是短暂的——就会出现只在高负载下、只在生产环境发生、开发环境几乎无法复现的一致性问题。

标准答案是"用 Redis Session store 就好了"，大部分情况下确实没错。但这要求代码的其他部分是真正无状态的。原版 Leverage 不是。

### 两套认证系统并行运行

更棘手的问题是 ContestUser。

Leverage 有两类用户：有平台账户的普通用户，以及可能是临时参赛者、有独立凭证、IP 绑定要求和不同访问规则的竞赛用户。原系统的解法是：搞了两套完全独立的认证路径，不共享任何逻辑。

普通用户认证：`express-session`，标准中间件，Session 里存 user ID。

竞赛用户认证：自定义中间件，不同的 Session 命名空间，竞赛专用字段，IP 检查内联在路由处理器里。

结果是两套做同一件事（验证身份、把用户上下文挂到请求上）的代码，实现方式完全不同。修任何 bug 要改两处，加任何新需求要改两处，做任何安全改进要改两处。

### Session 的结构性问题

实现细节背后还有更深的问题：HTTP Session 本质上是有状态的，而有状态是水平扩展的天敌。

在 Leverage 当前的规模下，这个问题无关紧要。但重写也是在搭两年内不需要推倒重来的基础设施。如果你想在负载均衡后面跑多个容器，Session 要么需要粘性会话（同一用户的请求总路由到同一容器），要么需要共享 Session store。粘性会话在容器挂掉时会出问题。共享 store 可以工作，但每次请求都多一次 Redis 往返——还没开始处理实际请求，就先付了一次延迟的代价。

JWT 把状态从服务端转移到了客户端。Token 里包含了验证身份所需的所有信息，服务端只负责验签。这是真实的扩展性优势，也有真实的代价——后面会讲。

## JWT 的设计

### Access Token + Refresh Token

我们用了双 Token 方案：

- **Access Token**：15 分钟过期，无状态，用 `jwt.accessSecret` 签名
- **Refresh Token**：7 天过期，用不同的 `jwt.refreshSecret` 签名

两个 Token 用不同的 secret 是有意为之：如果 access secret 泄露，攻击者能伪造 access token，但 refresh token（权力更大，因为能生成新的 access token）依然安全。你可以独立轮换 access secret。

```typescript
// auth.service.ts
private generateAccessToken(payload: JwtPayload): string {
  const expiresIn = this.configService.get<string>('jwt.accessExpiresIn', '15m')
  return this.jwtService.sign(payload, {
    secret: this.configService.get<string>('jwt.accessSecret'),
    expiresIn,
  })
}

private generateRefreshToken(payload: JwtPayload): string {
  const expiresIn = this.configService.get<string>('jwt.refreshExpiresIn', '7d')
  return this.jwtService.sign(payload, {
    secret: this.configService.get<string>('jwt.refreshSecret'),
    expiresIn,
  })
}
```

Access token 的 payload 包含：`sub`（user ID）、`username`、`role`。这就是大多数请求所需的全部——身份和权限等级，不需要数据库查询。

### ContestUser：同一套系统，不同的 Payload

这是设计对抗原版两套认证系统问题最直接的地方。

竞赛用户也拿 JWT，但 payload 结构不同：

```typescript
export interface ContestJwtPayload {
  sub: number       // userId，对应主账户
  contestId: number
  role: 'contest-user'
}
```

`contestId` 直接编码进 token 里。竞赛 JWT 是有范围限制的——你不能用 A 比赛的 token 访问 B 比赛。`role: 'contest-user'` 告诉 Guard 这是哪类用户。

关键在于：竞赛用户在数据库里对应的还是同一张 `User` 表，`ContestUser` 实体只是表示用户和比赛的关系（独立密码、IP 绑定、统计数据）。登录时验证凭证，生成竞赛范围的 JWT。Guard 负责执行竞赛特定的规则。

原来的两套中间件，被一套携带上下文的 token 格式加上知道如何处理它的 Guard 替代了。

### PBKDF2：历史兼容性问题

密码哈希方案的选择，其实是数据库逼的。

原系统用 `HMAC-SHA256(MD5(password))`，HMAC key 是全局固定的，没有每用户的 salt。代码审查那篇文章里说过，这是个严重的安全问题：如果配置泄露，可以预计算彩虹表，批量破解所有密码。

显然的修法是 bcrypt。行业标准，经过充分验证，自动处理 salt，GPU 抗性强。但有个问题：不知道明文就无法把现有密码重新用 bcrypt 哈希。数据库里有 4000+ 用户的旧格式哈希，如果直接切换 bcrypt 而不处理迁移，所有老用户都会丢失密码。

我们用 PBKDF2 加上迁移策略解决了这个问题：

```typescript
// crypto.util.ts
export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex')
  const hash = pbkdf2Sync(password, salt, 100000, 64, 'sha256').toString('hex')
  return `pbkdf2:${salt}:${hash}`
}

export function verifyPassword(password: string, stored: string): boolean {
  if (stored.startsWith('pbkdf2:')) {
    // 新格式：PBKDF2-SHA256，每用户独立 salt
    const [, salt, hash] = stored.split(':')
    const computed = pbkdf2Sync(password, salt, 100000, 64, 'sha256').toString('hex')
    return computed === hash
  }
  // 旧格式：HMAC-SHA256(MD5(password))
  return legacyVerify(password, stored)
}
```

登录流程里：

```typescript
// auth.service.ts
if (!verifyPassword(password, user.passwordHash)) {
  throw new UnauthorizedException('用户名或密码错误')
}

// 登录成功后，静默升级旧格式哈希
await this.upgradePasswordIfNeeded(user, password)
```

逻辑很简单：登录时用旧格式验证成功，立刻用 PBKDF2 重新哈希并更新数据库。下次登录就用新格式验证了。迁移在用户无感的情况下完成，一次一个，每次登录自然推进。

选 PBKDF2 而不是 bcrypt，一个实际原因是：PBKDF2 是 Node 内置 `crypto` 模块就有的，不需要额外依赖。对于一个 CPU 资源紧张的 OJ 平台，bcrypt 的主要优势（GPU 抗性）并不是首要威胁模型——我们更担心的是数据库被导出，而不是在线暴力破解。10 万次迭代的 PBKDF2 在这个场景下够用。

## Guard 的设计

### 三层结构

Guard 层级分三层：

1. **`JwtAuthGuard`**：验证 access token，对过期和格式错误分别给出不同错误消息
2. **`ContestAuthGuard`**：验证竞赛范围的 JWT，然后检查 IP 绑定
3. **`RolesGuard`**：根据 `@Roles()` 装饰器要求检查用户角色

```typescript
// jwt-auth.guard.ts — 继承 Passport 的 AuthGuard('jwt')
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  handleRequest<TUser = any>(err: any, user: TUser, info: any): TUser {
    if (info instanceof TokenExpiredError) {
      throw new UnauthorizedException('Token 已过期，请重新登录')
    }
    if (info instanceof JsonWebTokenError) {
      throw new UnauthorizedException('无效的 Token')
    }
    if (err || !user) {
      throw err ?? new UnauthorizedException('未授权')
    }
    return user
  }
}
```

角色系统用数字权重：`sa: 0, admin: 1, supervisor: 2, user: 3, contest-user: 4`。`@Roles('admin')` 的语义是"权重 ≤ 1"——admin 和 superadmin 可以访问，普通用户不行。这避免了把字符串比较散落在各个路由处理器里。

### `CurrentUser()` 装饰器

值得单独说的一个设计：`@CurrentUser()` 参数装饰器。

```typescript
// current-user.decorator.ts
export const CurrentUser = createParamDecorator(
  (data: keyof JwtPayload | undefined, ctx: ExecutionContext): JwtPayload | unknown => {
    const request = ctx.switchToHttp().getRequest()
    const user = request.user as JwtPayload
    return data ? user?.[data] : user
  },
)
```

用法：

```typescript
@Get('profile')
@UseGuards(JwtAuthGuard)
getProfile(@CurrentUser() user: JwtPayload): JwtPayload {
  return user
}

// 或者直接取某个字段：
@Get('my-submissions')
@UseGuards(JwtAuthGuard)
getSubmissions(@CurrentUser('sub') userId: number) {
  return this.submissionService.findByUser(userId)
}
```

比 `@Request() req: Request` 然后手动转型 `req.user` 干净得多。装饰器让意图明确，类型在编译时就能校验。

### 为什么用 Passport Strategy，但自己写 Guard

NestJS 文档把 Passport strategy 作为认证的惯用方案推荐。我们确实用了——`JwtAccessStrategy`、`JwtContestStrategy`、`JwtRefreshStrategy` 都继承自 `PassportStrategy`。但 Guard 是自己写的，不是直接用 Passport 的。

原因：`@nestjs/passport` 的 `AuthGuard('jwt')` 不给你控制错误响应的机会。Token 过期就是一个通用的 401。我们需要区分"token 过期"（客户端应该自动刷新）和"token 无效"（客户端应该弹登录框）。这个区别对前端 UX 很重要：自动重试刷新 token vs. 显示登录对话框。

`handleRequest()` 钩子给了我们这个控制权。它接收 Passport 验证结果和错误信息，我们可以在 NestJS 格式化 HTTP 响应之前抛出特定异常和特定消息。

## 一个还没解决的 Trade-off

JWT 有个众所周知的问题：Token 在过期前无法撤销。

如果账户被盗，或管理员需要强制下线，或比赛结束想立刻让所有竞赛 token 失效——你只能等 15 分钟的 access token 自然过期。实际上，15 分钟短到不构成灾难，但也不是零风险。

标准解法是 Redis 黑名单：登出或强制失效时，把 token 的 `jti`（JWT ID）加到 Redis set 里，TTL 和 token 一致。每次请求检查 `jti` 是否在黑名单里。

我们目前没做这个。登出接口的服务端实现是空的：

```typescript
// auth.controller.ts
@Post('logout')
@HttpCode(HttpStatus.NO_CONTENT)
logout(): void {
  // TODO: 实现 token 黑名单（Redis）
}
```

这是有意识的推迟。对 Leverage 当前的威胁模型（内部平台，学生做作业，可控的用户群体），没有即时撤销的风险较低。实现和维护黑名单的运营成本——尤其是把 TTL 和清理逻辑做对——不是小事。等风险大到值得付出这个代价，再加。

另一个思路是把 access token 的有效期缩短到 5 分钟，配合客户端自动静默刷新。这减小了撤销窗口，代价是更频繁的刷新请求。还没实现，但如果 15 分钟感觉太长，这是下一步。

Refresh token 在设计上应该存数据库（可撤销），这样就有了"从所有设备登出"的能力。这是未来的一个完善方向。

坦白说：我们用架构简洁换掉了即时撤销。Session 系统不存在这个权衡——Session 随时可撤销。JWT 的选择是在无状态简洁性和撤销能力之间找平衡点。我们选了更靠近无状态的那端，打算随着系统成熟逐步向可撤销方向迁移。

## 实际变化

之前：两套认证中间件、Redis 支撑的 Session、在 PM2 下会出问题的内存状态、差一次配置泄露就全军覆没的密码哈希。

现在：一套 JWT 系统、两种 token 类型（普通 + 竞赛）、职责清晰的三层 Guard、按需迁移的密码哈希。

Session 那套配置在单进程部署下能工作，但水平扩展需要大改。JWT 方案默认就支持水平扩展，ContestUser 用例也不再需要重复代码。

密码升级对用户无感。安全性随着每次登录悄悄提升。

这些不是戏剧性的改进——它们是那种让代码库六个月后依然好理解的无聊但正确的决定。这就是重写的意义。
