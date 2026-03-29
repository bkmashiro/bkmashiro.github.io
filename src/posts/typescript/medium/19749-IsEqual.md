---
date: 2026-03-29
description: TypeChallenge - 19749 - Medium - IsEqual
title: "19749 · IsEqual"
readingTime: true
tag:
  - TypeScript
  - TypeChallenge
  - TC-Medium
outline: [2, 3]
article: false
---

# 19749 · IsEqual

[Challenge Link](https://tsch.js.org/19749)

## Problem

Implement a type `IsEqual<A, B>` that returns `true` if `A` and `B` are exactly the same type, and `false` otherwise.

```ts
type cases = [
  Expect<Equal<IsEqual<1, 2>, false>>,
  Expect<Equal<IsEqual<never, never>, true>>,
  Expect<Equal<IsEqual<1, 1>, true>>,
  Expect<Equal<IsEqual<string, number>, false>>,
]
```

## Solution

```ts
type IsEqual<A, B> =
  (<T>() => T extends A ? 1 : 2) extends
  (<T>() => T extends B ? 1 : 2)
    ? true
    : false
```

## Explanation

This is the canonical TypeScript trick for strict type equality. It exploits a subtle behavior of conditional type assignability checking.

**Why not just `A extends B ? B extends A ? true : false : false`?**

That naive approach fails for several edge cases:
- `IsEqual<any, number>` would return `true` (because `any extends number` is `boolean`)
- `IsEqual<never, never>` — `never extends never` distributes and returns `never`, not `true`

**The trick:**

TypeScript's assignability checker for two generic functions `(<T>() => T extends X ? 1 : 2)` is compared structurally. Two such types are considered identical only if `X` in both positions is the **exact same type** — TypeScript does not apply conditional type distribution or `any`-widening here.

So `(<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2)` holds **if and only if** `A` and `B` are identical types.

**Key insight:** This pattern works because the assignability check on the deferred conditional type checks the type parameter `X` invariantly — it must match exactly, not just be a subtype.
