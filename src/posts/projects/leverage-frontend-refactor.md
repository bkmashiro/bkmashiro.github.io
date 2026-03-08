---
title: "Leverage OJ Frontend Rewrite: Nuxt 4 + Naive UI SPA"
description: "How I rewrote the Leverage OJ frontend from scratch using Nuxt 4 SPA mode, Naive UI, CodeMirror 6, and KaTeX — and the four bugs only Playwright E2E tests could catch."
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

The backend rewrite of Leverage OJ was already underway — clean architecture, proper migrations, real auth — but the frontend was still the original codebase: a Vue 2 app with scattered API calls, no type safety, and a build pipeline that took creativity to coax into working. If you're going to fix the foundation, you might as well fix the roof too.

This post covers the frontend rewrite: why we did it, what we chose, the architectural decisions that held up, and the bugs that only emerged when a Playwright test actually tried to use the thing.

## Why Rewrite the Frontend

The old frontend had accumulated the usual sins of a fast-moving project:

- **Vue 2** — EOL in December 2023. The ecosystem had already moved on; plugins weren't getting updates, and Options API code scattered across hundreds of files made refactoring painful.
- **No API layer abstraction** — `axios` calls were inline in components, some duplicated, some with subtly different error handling. Adding authentication headers required touching every one of them.
- **No type safety** — API responses were typed as `any`. TypeScript was present in name only.
- **Naive UI** was partially in use but not consistently. Some components used Element Plus, some were raw HTML.
- **Authentication state** was stored in Vuex with no token refresh logic. Tokens expired silently; users got logged out mid-submission.

The final straw: when we redesigned the API layer for the backend rewrite, the frontend would need to be updated in so many places that a targeted refactor would touch essentially everything anyway. At that point, you might as well start fresh.

## Technology Stack

### Nuxt 4, SPA Mode

We picked **Nuxt 4** in SPA mode rather than SSR for a specific reason: Leverage OJ is a judges-users-submissions platform where nearly all pages require authentication. SSR would add complexity (auth state hydration, cookie forwarding, SSR-safe localStorage access) with no real benefit — search engines don't need to index problem statements behind a login wall.

SPA mode gives us Nuxt's project structure, auto-imports, routing, and build tooling, without the hydration footprint.

### Naive UI

We'd already started adopting Naive UI in the old frontend, but inconsistently. In the new codebase, **Naive UI** is the only component library. It covers everything we need — tables, forms, modals, data pickers, code highlighting — and it plays well with Vue 3 Composition API.

One immediate win: Naive UI's `n-data-table` component handles pagination, sorting, and loading states in one component. The old table code was hundreds of lines of hand-rolled HTML.

### CodeMirror 6

The code editor is the most important component in an OJ frontend. Users spend more time interacting with the editor than anything else.

We chose **CodeMirror 6** over Monaco for two reasons: bundle size and flexibility. Monaco is excellent for a VS Code-like experience, but it's heavy and has opinions about how it wants to be rendered. CodeMirror 6's extension model lets us compose exactly the features we need: syntax highlighting for C++/Python/Java, vim keybindings (popular with competitive programmers), and custom themes.

The integration with Nuxt required some care — more on that in the challenges section.

### KaTeX

Problem statements in competitive programming are math-heavy. MathJax was the incumbent choice in older OJ systems, but it's slow to render and requires a separate pass after DOM insertion.

**KaTeX** renders synchronously and is dramatically faster. We use it with a Vue directive that runs on element mount and patches `$` / `$$` delimiters in problem content. It handles everything from simple inline fractions to complex summation notation without the flicker that MathJax produces.

## Architecture

### Composables as the API Layer

Instead of scattering axios calls throughout components, every API interaction goes through a composable in `composables/api/`. Each composable wraps one domain:

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

`useRequest` is the single place where auth headers are attached, errors are normalized, and token refresh is triggered. Nothing else touches axios directly.

### Pinia Auth Store + JWT Auto-Refresh

Authentication state lives in a **Pinia store** — not component-local state, not Vuex, not the old "check localStorage on every page load" pattern.

```typescript
// stores/auth.ts
export const useAuthStore = defineStore('auth', () => {
  const token = ref<string | null>(null)
  const user = ref<UserProfile | null>(null)
  const refreshTimer = ref<ReturnType<typeof setTimeout> | null>(null)

  function scheduleRefresh(expiresIn: number) {
    if (refreshTimer.value) clearTimeout(refreshTimer.value)
    // Refresh 60 seconds before expiry
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

When a user logs in, we extract the token expiry from the JWT payload and schedule an automatic refresh before it expires. If the refresh fails (network error, revoked session), we call `logout()` and redirect to the login page — no silent failures.

The store is persisted to `sessionStorage` via `pinia-plugin-persistedstate`, so page refreshes don't log users out.

## Integration Challenges

### CodeMirror 6 in Nuxt

CodeMirror 6's core is ESM-only, which is fine — but several extension packages have subtle import issues in SSR contexts. Even in SPA mode, Nuxt's Vite build can attempt to analyze imports that reference browser-only APIs during static generation.

The solution: wrap the editor in a `ClientOnly` component and lazy-load the CodeMirror imports:

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

The `.client.ts` suffix tells Nuxt this plugin is browser-only. The editor component imports from this plugin, guaranteeing it never runs during any server-side or build-time analysis.

### KaTeX Math Rendering

KaTeX works great until you render it inside a component that updates. A reactive problem statement (say, loading from an async API call) would replace the DOM with raw LaTeX strings if we weren't careful.

The solution is a Vue directive that runs `renderMathInElement` after every update cycle:

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

`throwOnError: false` is important — a malformed expression in a problem statement should show a fallback, not crash the renderer.

## AI-Assisted Development

A significant portion of the repetitive page scaffolding — list pages, detail pages, CRUD admin panels — was generated with an AI coding agent. The architecture was designed first (composables, store patterns, component conventions), then the agent was given the pattern and tasked with producing pages that conformed to it.

This worked well for high-volume, low-variation work. It saved probably two to three weeks of what would have otherwise been copy-paste coding. The interesting problems — the composable design, the auth flow, the editor integration — still needed human attention.

## What Playwright Found

Once the basic pages were working, we added **Playwright E2E tests** that automated a full user journey: register, login, browse problems, submit code, check results. Four bugs surfaced that had escaped manual testing.

### Bug 1: Naive UI Component Registration

Naive UI in Nuxt works via an auto-import plugin (`unplugin-vue-components`). Out of the box, it scans your template for `<n-xxx>` tags and auto-imports the corresponding component.

The issue: the plugin wasn't installed. Components were being imported globally in `app.vue` as a blunt instrument:

```typescript
// app.vue — wrong approach
import { NButton, NInput, NForm } from 'naive-ui'
```

This worked for the components explicitly listed but silently failed for any component used in a lazily-loaded page. Playwright's test for the submission form found that `NSelect` — used in the language selector — was missing. No console error; it just rendered as an empty div.

Fix: add `unplugin-vue-components` with the Naive UI resolver.

### Bug 2: NuxtLayout Not Wrapping Async Pages

Pages that depended on async data had a flash: on first load, the layout (navbar, sidebar) would render, then disappear, then re-appear after the page's `useAsyncData` resolved.

The cause: in Nuxt 4, `<NuxtLayout>` must wrap `<NuxtPage>` in `app.vue`, but if your layout component uses `<Suspense>` internally and the page is async, the layout can unmount while waiting. We had the layout defined at the page level (`definePageMeta({ layout: 'dashboard' })`), which interacts differently with async pages than wrapping at the app level.

Fix: move `<NuxtLayout>` to `app.vue` and remove layout definitions from individual pages.

### Bug 3: `imports.dirs` Not Covering Nested Composables

Auto-imports in Nuxt cover `composables/` by default, but only one level deep. Our API composables were in `composables/api/`, which isn't scanned.

Playwright's test for the problem list page threw a runtime error: `useProblemApi is not defined`. It worked in development (where Vite's HMR hot-patches things more forgivingly) but failed in the built output.

Fix: add `imports.dirs` to `nuxt.config.ts`:

```typescript
export default defineNuxtConfig({
  imports: {
    dirs: ['composables', 'composables/api', 'composables/utils']
  }
})
```

### Bug 4: `axios res.data` Double-Unwrap

The `useRequest` composable returned `response.data` from axios — correct. But somewhere in the refactor, the API composables were also doing `return response.data`, which meant the final value was `response.data.data` on the occasions the backend wrapped responses in a `{ data: ... }` envelope.

The bug was invisible in development because we were looking at the UI, not the raw objects. Playwright's assertion that `submission.status === 'AC'` failed because `submission` was actually `{ data: { status: 'AC' } }`.

Fix: remove the double unwrap — one layer of `.data` extraction happens in `useRequest`, none in the individual API functions.

## Retrospective

The rewrite took longer than a targeted refactor would have, but it eliminated whole categories of bugs rather than patching them one at a time. The Playwright suite now runs on every push and catches regressions before they reach production.

A few things I'd do differently:

- **Set up Playwright earlier.** We added tests after the pages were built. Running them during development would have caught the component registration and layout bugs immediately.
- **Define the composable directory structure up front.** The `imports.dirs` issue was entirely avoidable with five minutes of configuration at the start.

The stack — Nuxt 4 SPA + Naive UI + CodeMirror 6 + KaTeX — held up well. No regrets on the choices, only on not testing them sooner.
