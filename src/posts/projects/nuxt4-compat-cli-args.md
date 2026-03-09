---
title: "Nuxt 4 Compat Mode Silently Breaks When You Pass CLI Args Wrong"
description: "How `pnpm dev -- --host 0.0.0.0` bypasses nuxt.config.ts and shows the Welcome page — and the one-liner fix."
date: 2026-03-09
readingTime: true
tag:
  - Nuxt
  - Vue
  - Debugging
  - Frontend
outline: [2, 3]
---

It was 2 AM. The Leverage OJ frontend had been happily serving pages for hours, then something caused it to crash. A quick restart later, every route returned the default Nuxt welcome screen:

> *Remove this welcome page by replacing `<NuxtWelcome />` in app.vue with your own code...*

The code hadn't changed. The `app/app.vue` was intact. So what happened?

## The Setup

The project uses **Nuxt 3.21.1** with the Nuxt 4 compatibility flag:

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  future: { compatibilityVersion: 4 },
  // ...
})
```

With `compatibilityVersion: 4`, Nuxt 3 adopts the Nuxt 4 directory convention: source files live in `app/` instead of the root. So `app/app.vue`, `app/pages/`, `app/layouts/`, etc.

This had been working fine for months.

## The Restart That Broke Everything

To expose the dev server over the network (via Tailscale), I restarted with:

```bash
PORT=3001 pnpm dev -- --host 0.0.0.0
```

Nuxt started up, returned HTTP 200, and showed... the Welcome page.

## Debugging the Symptom

First instinct: cache. Cleared `.nuxt/`, `node_modules/.cache/`. No change.

Then I noticed something in the startup log. Normally, Nuxt 4 compat mode prints:

```
[nuxt] ℹ Running with compatibility version 4
```

That line was **missing**. And the Nitro build was suspiciously fast — ~400ms instead of the usual ~1800ms. Nuxt wasn't scanning `app/` at all; it was using its internal defaults.

## The Actual Cause

The culprit was `-- --host 0.0.0.0`.

In shell, `--` signals "end of options for this command; everything after goes to the subprocess." So `pnpm dev -- --host 0.0.0.0` passes `--host 0.0.0.0` to `nuxt dev`. That's intended.

But in Nuxt 3.21.1, something in how CLI arguments are parsed causes `--host` (or its presence alongside other flags) to **silently skip reading `nuxt.config.ts`** when `compatibilityVersion: 4` is set. The server starts with a bare default configuration — no `future`, no `srcDir`, no modules — and falls back to rendering `NuxtWelcome`.

I spent a while going down the wrong path: adding `srcDir: 'app'` explicitly, removing `compatibilityVersion`, trying `dir.*` config — all of which made things worse or did nothing.

## The Fix

Stop passing `--host` as a CLI flag. Use an environment variable instead:

```bash
# ❌ Broken — silently skips nuxt.config.ts
PORT=3001 pnpm dev -- --host 0.0.0.0

# ✅ Works — Nuxt reads config correctly
NUXT_HOST=0.0.0.0 PORT=3001 pnpm dev
```

With the env var approach, the startup log shows:

```
[nuxt] ℹ Running with compatibility version 4
[nitro] ✔ Nuxt Nitro server built in 1841ms   ← proper scan time
```

And the title in the HTML becomes `<title>Leverage OJ</title>` instead of `<title>Welcome to Nuxt!</title>`.

## Why This Happens

My best guess: Nuxt 4 compat mode changes how the config is bootstrapped. The `compatibilityVersion` flag is processed early in the config loading pipeline, and there's a bug (or undocumented behavior) where certain CLI argument combinations interrupt that early initialization. Since the server still starts successfully, there's no error — just silent degraded behavior.

I haven't filed a Nuxt issue yet, but it's reproducible on 3.21.1 with `compatibilityVersion: 4`.

## Lessons

1. **Missing startup log lines are a signal.** `[nuxt] ℹ Running with compatibility version 4` not appearing means the config wasn't loaded — full stop.
2. **Build time is a proxy for correctness.** 400ms Nitro build = no files scanned. 1800ms = normal. If it feels too fast, something is wrong.
3. **Don't pass `--host` via `--` to Nuxt dev in compat mode.** Use `NUXT_HOST` instead.
4. **Don't thrash the config.** I spent 30 minutes adding/removing `srcDir`, `dir.*`, and `compatibilityVersion` when the config was fine all along. When in doubt, restore and look elsewhere.
