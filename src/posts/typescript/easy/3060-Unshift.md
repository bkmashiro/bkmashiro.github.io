---
date: 2026-03-29
description: TypeChallenge - 3060 - Easy - Unshift
title: "3060 · Unshift"
readingTime: true
tag:
  - TypeScript
  - TypeChallenge
  - TC-Easy
outline: [2, 3]
article: false
---

# 3060 · Unshift

[Challenge Link](https://tsch.js.org/3060)

## Problem

Implement the type version of `Array.unshift`.

```ts
type Result = Unshift<[1, 2], 0> // [0, 1, 2]
```

## Solution

```ts
type Unshift<T extends any[], U> = [U, ...T]
```

## Explanation

We use **tuple spreading** to construct a new tuple that prepends `U` before all elements of `T`.

**Step by step:**
1. `T extends any[]` — constrains `T` to be an array/tuple type
2. `[U, ...T]` — places `U` first, then spreads all elements of `T`

This is the mirror of `Push`: instead of appending to the end, we prepend to the beginning — matching what `Array.prototype.unshift` does at runtime.

**Key concept:**
- [Variadic Tuple Types](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-4-0.html#variadic-tuple-types) — `[U, ...T]` creates a new tuple type with `U` prepended
