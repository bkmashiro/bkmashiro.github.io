---
title: "NestJS 应用重构后的安全审计：我们发现了什么"
description: "大规模重构新增了 50+ 个 endpoint，我们用权限矩阵做了系统性安全审计。记录了发现的问题——包括一个权限回归 bug，以及一个在生产环境存活了多年的 FIXME 注释。"
date: 2026-03-08
readingTime: true
tag:
  - Security
  - NestJS
  - Backend
  - Auth
outline: [2, 3]
---

向生产应用新增 50+ 个 endpoint，你不只是有了一个新功能，而是有了一个新的攻击面。Leverage OJ 后端重写几乎改动了系统里的每一个路由，引入了新的角色层级体系，并替换了整个认证层。这类改动正是会产生权限 bug 的地方：旧系统里生效的访问控制，要么没有移植过来，要么移植错了。

上线前我们做了系统性的安全审计。这篇文章记录审计方法和发现的问题——包括一个会让错误用户触发代码重评测的回归 bug，以及一个在生产环境没有任何访问控制、静静存在多年的 FIXME 注释。

## 背景：发生了什么变化

原来的 Leverage OJ 后端角色结构比较扁平。重写后引入了更清晰的三级层级：

- **User** — 标准认证用户；可以提交解题代码、查看自己的提交记录
- **Supervisor** — 可以管理题目、查看所有提交、触发重评测
- **Admin** — 完整系统权限，用户管理，系统配置

旧代码库用 `express-session` 加自定义中间件做内联角色检查。新代码库用 NestJS guard：

```typescript
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.Supervisor)
@Post('/rejudge/:id')
async rejudge(@Param('id') id: number) {
  // ...
}
```

从内联中间件迁移到声明式 guard 是个进步。在角色分配正确的前提下确实如此。

## 审计方法：权限矩阵

我们没有逐条 ad hoc 审计 endpoint，而是建了一张**权限矩阵**：把每个 endpoint 映射到预期访问级别的表格。

格式很简单：

| Endpoint | Method | 预期角色 | 实际 Guard | 状态 |
|----------|--------|----------|-----------|------|
| `/problems` | GET | 公开 | 无 | ✅ |
| `/problems/:id` | GET | User | JwtAuthGuard | ✅ |
| `/problems` | POST | Supervisor | JwtAuthGuard + RolesGuard(Supervisor) | ✅ |
| `/submissions/:id/rejudge` | POST | Supervisor | JwtAuthGuard + RolesGuard(Admin) | ❌ |
| `/submissions/:id/inspect` | GET | Supervisor | 无 | ❌ |

流程：

1. 导出所有带方法和路径的路由（NestJS 可以通过 `RoutesResolver` 枚举，或者直接读模块结构）
2. 根据 endpoint 功能，给每个路由分配预期访问级别
3. 从源码读取实际的 guard 装饰器
4. 标记所有不匹配项

过程枯燥但不复杂。50+ 个新 endpoint，完整填完矩阵大概花了三个小时。

## 发现了什么

### 问题一：`rejudge` 权限回归

`rejudge` endpoint——重新将提交代码排队进行评测——应该需要 **Supervisor** 权限。Supervisor 在评测机崩溃、评测中断，或者题目测试用例更新时，需要频繁重触发评测。

重构过程中，这个 guard 被设成了 `Role.Admin`：

```typescript
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.Admin)  // ← 错误
@Post('/submissions/:id/rejudge')
async rejudge(@Param('id') id: number) {
  return this.judgeService.rejudge(id)
}
```

这是**反方向的权限提升**：endpoint 变得比应该的更严格，实际上剥夺了 supervisor 对他们需要的功能的访问权限。上线后的症状就是 supervisor 触发重评测时一直收到 403——烦人，但还不构成安全漏洞。

但任何方向的不匹配都说明权限模型没有被一致地应用，这本身就是问题。一个 guard 设错了，其他的可能也有问题。

修复：

```typescript
@Roles(Role.Supervisor)  // ← 正确：supervisor 及以上
```

### 问题二：变成生产代码的 FIXME

更令人担忧的发现在原来代码库的 `/submissions/:id/inspect` endpoint。这个 endpoint 返回提交的完整详情——包括提交的代码和评测机的内部评测日志。

原来的代码：

```typescript
// FIXME: should check permissions here
@Get('/submissions/:id/inspect')
async inspect(@Param('id') id: number) {
  return this.submissionsService.getFullDetails(id)
}
```

没有 auth guard，没有角色检查。任何带有提交 ID 的请求——无论是否认证——都能拿到系统里任意提交的完整内容。

`// FIXME` 注释说明有人知道这是错的。他们写了这个 endpoint，记录了缺失的访问控制，然后要么时间不够，要么忘记回来处理了。这个注释在代码库里活了足够长的时间，进了生产环境。

这是有实质意义的数据泄露：提交的代码是用户的知识产权，在比赛场景下，能实时读取其他用户的解题代码是直接的作弊手段。提交 ID 是顺序递增的整数，枚举极其简单。

新后端用两种方式修复了这个问题：

```typescript
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.Supervisor)
@Get('/submissions/:id/inspect')
async inspect(@Param('id') id: number, @CurrentUser() user: User) {
  return this.submissionsService.getFullDetails(id)
}
```

Supervisor 可以查看任意提交的详情。普通用户完全不能访问这个 endpoint——如果他们想看自己的代码，用标准的提交详情 endpoint，那个只返回当前用户自己的提交。

## 新架构的安全改进

除了具体的发现，重写还引入了一些结构性改变，让权限模型更难出错。

### `ValidationPipe` 配置 `whitelist: true`

原来的后端接受请求体里的任意属性，并将它们传给 TypeORM。如果客户端在 POST 请求体里发了额外字段——比如注册请求里带上 `role: 'admin'`——这些字段可能会根据 entity 的配置方式进入数据库。

新后端全局配置了 `ValidationPipe`：

```typescript
app.useGlobalPipes(
  new ValidationPipe({
    whitelist: true,             // 剥离未知属性
    forbidNonWhitelisted: true,  // 出现未知属性时抛 400 错误
    transform: true,             // 自动转换为 DTO 类型
  })
)
```

`whitelist: true` 会剥离任何未在 DTO 类中声明的属性。`forbidNonWhitelisted: true` 更进一步，如果客户端发送未知字段就抛 400 错误。这从框架层面完全防止了批量赋值攻击。

### `JwtAuthGuard` + `RolesGuard` 分层设计

原来的系统把认证和鉴权合并在单个中间件函数里。新系统将它们清晰分离：

- `JwtAuthGuard` 校验 JWT 并将用户附加到请求上。它只做一件事。
- `RolesGuard` 读取 `@Roles()` 装饰器，检查附加的用户是否具备所需角色。它也只做一件事。

这种分离让每个 guard 可以独立测试，也让权限 bug 在 code review 时更容易被发现。看到 `@UseGuards(JwtAuthGuard, RolesGuard)` 加上 `@Roles(Role.Supervisor)`，意图一目了然。

需要认证但不需要特定角色的 endpoint，只用 `JwtAuthGuard`。公开 endpoint，两个 guard 都不用。模式是显式的，不是隐式的。

## 经验

**每次大规模重构后都要做权限审计。** 矩阵方法可以扩展——机械到足以部分自动化，而且能发现孤立看单个 endpoint 时察觉不到的不匹配。`rejudge` 的回归孤立来看是"正确的"（有 guard！有角色要求！），但只有和预期行为对比才能看出问题。

**FIXME 注释是等待发作的安全漏洞。** 一个记录了缺失访问控制的注释比什么都没有强，但不是修复。在生产代码库里，`// FIXME: add auth` 这样的注释应该被当成已知漏洞，直到它被解决为止。

**显式优于隐式。** 原来的中间件方式很容易忘记加权限检查。NestJS 的装饰器方式让你很容易*看出*一个路由没有 guard——`@UseGuards()` 的缺失视觉上很明显。显式的代价是多几行代码，收益是安全要求在源代码里有据可查。

审计花了几个小时，发现的 bug 在上线后处理的代价会大得多。
