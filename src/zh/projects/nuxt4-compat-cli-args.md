---
title: "Nuxt 4 兼容模式在 CLI 参数传递错误时悄悄失效"
description: "为什么 `pnpm dev -- --host 0.0.0.0` 会绕过 nuxt.config.ts 并显示欢迎页面——以及一行修复。"
date: 2026-03-09
readingTime: true
tag:
  - Nuxt
  - Vue
  - 调试
  - 前端
outline: [2, 3]
---

凌晨 2 点。Leverage OJ 前端已经愉快地服务页面好几个小时了，然后某些东西导致它崩溃。快速重启后，每个路由都返回默认的 Nuxt 欢迎页面：

> *通过将 `<NuxtWelcome />` 替换为你自己的代码来移除这个欢迎页面...*

代码没有改变。`app/app.vue` 完好无损。那发生了什么？

## 背景设置

项目使用带有 Nuxt 4 兼容标志的 **Nuxt 3.21.1**：

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  future: { compatibilityVersion: 4 },
  // ...
})
```

使用 `compatibilityVersion: 4`，Nuxt 3 采用 Nuxt 4 的目录约定：源文件放在 `app/` 而不是根目录。所以是 `app/app.vue`、`app/pages/`、`app/layouts/` 等。

这已经正常工作好几个月了。

## 破坏一切的重启

为了通过网络（通过 Tailscale）暴露开发服务器，我用以下命令重启：

```bash
PORT=3001 pnpm dev -- --host 0.0.0.0
```

Nuxt 启动了，返回 HTTP 200，然后显示... 欢迎页面。

## 调试症状

第一直觉：缓存。清除了 `.nuxt/`、`node_modules/.cache/`。没有变化。

然后我注意到启动日志中的一些东西。正常情况下，Nuxt 4 兼容模式会打印：

```
[nuxt] ℹ Running with compatibility version 4
```

那一行**不见了**。而且 Nitro 构建快得可疑——约 400ms 而不是通常的约 1800ms。Nuxt 根本没有扫描 `app/`；它在使用内部默认值。

## 真正的原因

罪魁祸首是 `-- --host 0.0.0.0`。

在 shell 中，`--` 表示"此命令的选项结束；之后的一切都传给子进程"。所以 `pnpm dev -- --host 0.0.0.0` 将 `--host 0.0.0.0` 传给 `nuxt dev`。这是预期的。

但在 Nuxt 3.21.1 中，CLI 参数解析方式的某些东西在设置了 `compatibilityVersion: 4` 时导致 `--host`（或它与其他标志一起出现）**悄悄跳过读取 `nuxt.config.ts`**。服务器用裸的默认配置启动——没有 `future`、没有 `srcDir`、没有 modules——并回退到渲染 `NuxtWelcome`。

我花了一段时间走错路：显式添加 `srcDir: 'app'`、移除 `compatibilityVersion`、尝试 `dir.*` 配置——所有这些要么让事情更糟，要么什么都没做。

## 修复

停止将 `--host` 作为 CLI 标志传递。改用环境变量：

```bash
# ❌ 失效 — 悄悄跳过 nuxt.config.ts
PORT=3001 pnpm dev -- --host 0.0.0.0

# ✅ 有效 — Nuxt 正确读取配置
NUXT_HOST=0.0.0.0 PORT=3001 pnpm dev
```

使用环境变量方法，启动日志显示：

```
[nuxt] ℹ Running with compatibility version 4
[nitro] ✔ Nuxt Nitro server built in 1841ms   ← 正常的扫描时间
```

HTML 中的标题变成 `<title>Leverage OJ</title>` 而不是 `<title>Welcome to Nuxt!</title>`。

## 为什么会发生这种情况

我的最佳猜测：Nuxt 4 兼容模式改变了配置引导的方式。`compatibilityVersion` 标志在配置加载流水线的早期处理，有一个 bug（或未记录的行为）导致某些 CLI 参数组合中断了那个早期初始化。因为服务器仍然成功启动，所以没有错误——只是静默降级的行为。

我还没有提交 Nuxt issue，但它在 3.21.1 + `compatibilityVersion: 4` 上是可复现的。

## 教训

1. **缺失的启动日志行是信号。** `[nuxt] ℹ Running with compatibility version 4` 没有出现意味着配置没有加载——句号。
2. **构建时间是正确性的代理。** 400ms Nitro 构建 = 没有扫描文件。1800ms = 正常。如果感觉太快，说明有问题。
3. **不要在兼容模式下通过 `--` 将 `--host` 传给 Nuxt dev。** 改用 `NUXT_HOST`。
4. **不要乱改配置。** 我花了 30 分钟添加/移除 `srcDir`、`dir.*` 和 `compatibilityVersion`，而配置一直都是对的。当有疑问时，恢复并看别处。
