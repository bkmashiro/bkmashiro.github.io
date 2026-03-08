---
title: "Leverage OJ 前端重写：Nuxt 4 + Naive UI SPA"
description: "用 Nuxt 4 SPA 模式、Naive UI、CodeMirror 6 和 KaTeX 从零重写 Leverage OJ 前端的全过程，以及只有 Playwright E2E 测试才能发现的四个 bug。"
date: 2026-03-08
readingTime: true
tag:
  - Frontend
  - Nuxt
  - Vue
  - TypeScript
  - Testing
outline: [2, 3]
---

Leverage OJ 的后端重写已经在进行中——干净的架构、正经的 migration、真实的认证体系——但前端还是原来那套：Vue 2 的应用，API 调用散落各处，没有类型安全，构建流水线需要点运气才能跑起来。既然要修地基，屋顶也一起修了吧。

这篇文章记录前端重写的全过程：为什么做、选了什么技术、哪些架构决策经受住了考验，以及 Playwright 测试实际跑起来之后才暴露的那几个 bug。

## 为什么要重写前端

旧前端积累了快速迭代项目的常见问题：

- **Vue 2** — 2023 年 12 月正式 EOL。生态已经移走，插件停止更新，几百个文件里散落的 Options API 代码让重构极其痛苦。
- **没有 API 层抽象** — `axios` 调用直接写在组件里，有的重复，有的错误处理逻辑微妙不同。给每个请求加认证头需要改动每一处。
- **没有类型安全** — API 响应类型是 `any`。TypeScript 只是名义上存在。
- **Naive UI** 有部分引入但不统一。有的地方用 Element Plus，有的直接写原生 HTML。
- **认证状态** 存在 Vuex 里，没有 token 刷新逻辑。Token 悄悄过期，用户在提交代码途中被踢出登录。

压垮骆驼的最后一根稻草：后端重写重新设计了 API 层，前端需要在太多地方同步更新，定向重构基本等于全改。既然如此，不如从头开始。

## 技术选型

### Nuxt 4，SPA 模式

选择 **Nuxt 4** SPA 模式而非 SSR，理由很具体：Leverage OJ 几乎所有页面都需要登录。SSR 会带来额外复杂度（认证状态 hydration、cookie 转发、SSR 安全的 localStorage 访问），但没有任何实际收益——搜索引擎不需要索引登录墙后面的题目内容。

SPA 模式保留了 Nuxt 的项目结构、自动导入、路由和构建工具，去掉了 hydration 的包袱。

### Naive UI

旧前端已经开始引入 Naive UI，但使用不统一。新项目里，**Naive UI** 是唯一的组件库，覆盖所需的一切：表格、表单、弹窗、日期选择器、代码高亮——而且和 Vue 3 Composition API 配合很顺畅。

一个立竿见影的收益：Naive UI 的 `n-data-table` 组件在一个组件里搞定了分页、排序和加载状态。旧的表格代码是几百行手写 HTML。

### CodeMirror 6

代码编辑器是 OJ 前端最重要的组件。用户跟它互动的时间比跟其他任何东西都多。

我们选了 **CodeMirror 6** 而不是 Monaco，理由是体积和灵活性。Monaco 很优秀，但体积大，而且对渲染方式有自己的主见。CodeMirror 6 的扩展模型让我们可以按需组合功能：C++/Python/Java 的语法高亮、vim 键位绑定（竞赛选手很喜欢），以及自定义主题。

与 Nuxt 的集成需要一些处理——详见后面的挑战部分。

### KaTeX

竞赛编程的题目里数学公式很多。MathJax 是旧 OJ 系统的默认选择，但渲染慢，而且需要在 DOM 插入后再跑一遍。

**KaTeX** 同步渲染，速度快得多。我们用一个 Vue 指令，在元素挂载时处理题目内容里的 `$` / `$$` 分隔符。无论是简单的行内分数还是复杂的求和符号，都能处理，而且没有 MathJax 那种闪烁感。

## 架构设计

### Composables 作为 API 层

不再在组件里散落 axios 调用，所有 API 交互都通过 `composables/api/` 下的 composable 进行。每个 composable 封装一个领域：

```typescript
// composables/api/useProblemApi.ts
export function useProblemApi() {
  const { request } = useRequest()

  return {
    async getProblems(params: ProblemQueryParams): Promise<PaginatedResponse<Problem>> {
      return request({ method: 'GET', url: '/problems', params })
    },
    async getProblem(id: number): Promise<Problem> {
      return request({ method: 'GET', url: `/problems/${id}` })
    },
    async submitSolution(id: number, body: SubmitBody): Promise<Submission> {
      return request({ method: 'POST', url: `/problems/${id}/submit`, data: body })
    },
  }
}
```

`useRequest` 是唯一负责附加认证头、统一处理错误、触发 token 刷新的地方。其他任何地方都不直接碰 axios。

### Pinia Auth Store + JWT 自动刷新

认证状态存在 **Pinia store** 里——不是组件局部状态，不是 Vuex，不是旧的"每次页面加载都检查 localStorage"模式。

```typescript
// stores/auth.ts
export const useAuthStore = defineStore('auth', () => {
  const token = ref<string | null>(null)
  const user = ref<UserProfile | null>(null)
  const refreshTimer = ref<ReturnType<typeof setTimeout> | null>(null)

  function scheduleRefresh(expiresIn: number) {
    if (refreshTimer.value) clearTimeout(refreshTimer.value)
    // 在过期前 60 秒刷新
    const delay = Math.max((expiresIn - 60) * 1000, 0)
    refreshTimer.value = setTimeout(doRefresh, delay)
  }

  async function doRefresh() {
    try {
      const res = await authApi.refresh()
      token.value = res.accessToken
      scheduleRefresh(res.expiresIn)
    } catch {
      logout()
    }
  }

  // ...
})
```

用户登录时，我们从 JWT payload 中提取过期时间，并在过期前自动调度刷新。如果刷新失败（网络错误、session 被吊销），调用 `logout()` 并跳转到登录页——不会静默失败。

Store 通过 `pinia-plugin-persistedstate` 持久化到 `sessionStorage`，刷新页面不会退出登录。

## 集成挑战

### CodeMirror 6 在 Nuxt 里的使用

CodeMirror 6 的核心是纯 ESM，这没问题——但一些扩展包在 SSR 上下文中有微妙的导入问题。即使是 SPA 模式，Nuxt 的 Vite 构建在静态生成阶段也可能尝试分析引用了浏览器 API 的导入。

解决方案：用 `ClientOnly` 组件包裹编辑器，并懒加载 CodeMirror 导入：

```typescript
// plugins/codemirror.client.ts
import { EditorView, basicSetup } from 'codemirror'
import { cpp } from '@codemirror/lang-cpp'
import { python } from '@codemirror/lang-python'

export default defineNuxtPlugin(() => {
  return {
    provide: {
      EditorView,
      basicSetup,
      languages: { cpp, python }
    }
  }
})
```

`.client.ts` 后缀告诉 Nuxt 这个插件只在浏览器端运行。编辑器组件从这个插件导入，保证它永远不会在服务端或构建时分析阶段执行。

### KaTeX 数学公式渲染

KaTeX 本身运行良好，但在会更新的组件里渲染就要小心了。如果题目内容是异步加载的（从 API 获取），组件更新时 DOM 会被替换成原始 LaTeX 字符串，除非特别处理。

解决方案是一个 Vue 指令，在每次更新周期后运行 `renderMathInElement`：

```typescript
// directives/katex.ts
import renderMathInElement from 'katex/contrib/auto-render'

export const vKatex = {
  mounted: renderKatex,
  updated: renderKatex,
}

function renderKatex(el: HTMLElement) {
  renderMathInElement(el, {
    delimiters: [
      { left: '$$', right: '$$', display: true },
      { left: '$', right: '$', display: false },
    ],
    throwOnError: false,
  })
}
```

`throwOnError: false` 很重要——题目内容里的格式错误表达式应该显示 fallback，而不是让渲染器崩溃。

## AI 辅助开发

大量重复的页面脚手架工作——列表页、详情页、CRUD 管理面板——都用 AI coding agent 生成的。架构先设计好（composable 规范、store 模式、组件约定），然后让 agent 按照这些模式生成符合规范的页面。

这个方式在高量低变的工作上效果很好，大概节省了两三周本来会花在复制粘贴上的时间。真正有意思的问题——composable 设计、认证流、编辑器集成——还是需要人来处理。

## Playwright 发现了什么

基本页面功能可用之后，我们加了 **Playwright E2E 测试**，自动化完整的用户旅程：注册、登录、浏览题目、提交代码、查看结果。四个 bug 因此浮出水面，都是手动测试没发现的。

### Bug 1：Naive UI 组件注册问题

Naive UI 在 Nuxt 中通过 `unplugin-vue-components` 自动导入。这个插件扫描模板里的 `<n-xxx>` 标签并自动导入对应组件。

问题是：这个插件根本没装。组件是在 `app.vue` 里全局粗暴导入的：

```typescript
// app.vue — 错误做法
import { NButton, NInput, NForm } from 'naive-ui'
```

这对明确列出的组件有效，但对懒加载页面中使用的组件悄悄失败。Playwright 的提交表单测试发现语言选择器里用的 `NSelect` 不见了——没有控制台报错，就渲染成了一个空 div。

修复：安装 `unplugin-vue-components` 并配置 Naive UI resolver。

### Bug 2：NuxtLayout 没有包裹异步页面

依赖异步数据的页面有一个闪烁问题：首次加载时，布局（导航栏、侧边栏）会先渲染，然后消失，然后在页面的 `useAsyncData` resolve 之后重新出现。

原因：在 Nuxt 4 中，`<NuxtLayout>` 必须在 `app.vue` 里包裹 `<NuxtPage>`，但如果布局组件内部用了 `<Suspense>`，而页面又是异步的，等待期间布局可能会卸载。我们在页面级别定义布局（`definePageMeta({ layout: 'dashboard' })`），这种方式和异步页面的交互方式与在 app 层级包裹不同。

修复：把 `<NuxtLayout>` 移到 `app.vue`，从各个页面移除 layout 定义。

### Bug 3：`imports.dirs` 没有覆盖嵌套 composables

Nuxt 的自动导入默认覆盖 `composables/`，但只扫描一层。我们的 API composable 在 `composables/api/` 下，没有被扫描到。

Playwright 的题目列表页测试抛出了运行时错误：`useProblemApi is not defined`。开发环境下能跑（Vite 的 HMR 更宽松），构建产物里就挂了。

修复：在 `nuxt.config.ts` 里加 `imports.dirs`：

```typescript
export default defineNuxtConfig({
  imports: {
    dirs: ['composables', 'composables/api', 'composables/utils']
  }
})
```

### Bug 4：`axios res.data` 双重解包

`useRequest` composable 返回 axios 的 `response.data`——这是对的。但重构过程中，API composable 里也在做 `return response.data`，导致当后端把响应包在 `{ data: ... }` 信封里时，最终拿到的是 `response.data.data`。

开发时这个 bug 不可见，因为我们看的是 UI，不是原始对象。Playwright 断言 `submission.status === 'AC'` 失败，因为 `submission` 实际上是 `{ data: { status: 'AC' } }`。

修复：去掉双重解包——一层 `.data` 提取在 `useRequest` 里做，各个 API 函数里不再做。

## 回顾

重写花的时间比定向重构更长，但它消灭了整个类别的 bug，而不是一个一个打补丁。Playwright 测试套件现在在每次推送时运行，在到达生产环境之前捕获回归问题。

几件我会做不同的事：

- **更早引入 Playwright。** 我们在页面建好之后才加测试。在开发过程中跑测试，组件注册和布局的 bug 会立刻暴露。
- **一开始就定好 composable 目录结构。** `imports.dirs` 的问题完全可以在最开始用五分钟配置好来避免。

整个技术栈——Nuxt 4 SPA + Naive UI + CodeMirror 6 + KaTeX——经受住了考验。选型本身没有遗憾，只是没有更早测试这件事有遗憾。
