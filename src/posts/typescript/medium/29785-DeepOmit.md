---
date: 2024-08-18
description: TypeChallenge - 29785
title: Deep Omit
readingTime: true
tag:
  - TypeScript
  - TypeChallenge
  - TC-Medium
outline: [2, 3]
article: false
---

# Deep Omit
[Problem Link](https://tsch.js.org/29785)

## Problem

Implement a type `DeepOmit<T, K>`, which omits the property `K` (a dot-separated path) from nested objects.

```ts
type T = {
  a: string
  b: {
    c: string
    d: {
      e: string
      f: string
    }
  }
}

type T0 = DeepOmit<T, 'b'>       // { a: string }
type T1 = DeepOmit<T, 'b.c'>     // { a: string; b: { d: { e: string; f: string } } }
type T2 = DeepOmit<T, 'b.d.e'>   // { a: string; b: { c: string; d: { f: string } } }
```

## Solution

```ts
type DeepOmit<T, K extends string> =
  K extends `${infer Head}.${infer Tail}`
    ? {
        [P in keyof T]: P extends Head
          ? DeepOmit<T[P], Tail>
          : T[P]
      }
    : Omit<T, K>
```

**How it works:**
1. Check if `K` contains a `.` separator.
2. If yes, split into `Head` (first segment) and `Tail` (rest).
   - Keep all properties unchanged, except for `Head` — recurse into its value with `Tail`.
3. If no `.`, we are at the final key — use standard `Omit<T, K>` to remove it.

## Key Takeaways

- Parsing a dot-separated path with `` K extends `${infer Head}.${infer Tail}` `` is the standard recursive path-descent pattern.
- The recursion matches the path segment-by-segment, delegating the omit to the leaf level.
- At the leaf, `Omit<T, K>` handles the actual removal.
