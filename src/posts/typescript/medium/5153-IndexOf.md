---
date: 2026-03-29
description: TypeChallenge - 5153
title: IndexOf
readingTime: true
tag:
  - TypeScript
  - TypeChallenge
  - TC-Medium
outline: [2, 3]
article: false
---

# IndexOf
[Problem Link](https://tsch.js.org/5153)

## Problem

Implement the type version of `Array.indexOf`, `IndexOf<T, U>` takes an Array `T`, any `U` and returns the index of the first `U` in Array `T`.

```ts
type Res = IndexOf<[1, 2, 3], 2>          // 1
type Res1 = IndexOf<[2, 6, 3, 8, 4, 1, 7, 3, 9], 3>  // 2
type Res2 = IndexOf<[0, 0, 0], 2>         // -1
```

## Solution

### Approach: Linear Scan with Index Counter

Walk through the tuple, comparing each element to `U` using `IsEqual`.

```ts
type IsEqual<A, B> =
  (<T>() => T extends A ? 1 : 2) extends
  (<T>() => T extends B ? 1 : 2)
    ? true : false

type IndexOf<T extends unknown[], U, Count extends unknown[] = []> =
  T extends [infer Head, ...infer Tail]
    ? IsEqual<Head, U> extends true
      ? Count['length']
      : IndexOf<Tail, U, [...Count, unknown]>
    : -1
```

**How it works:**
1. Extract `Head` from `T` and compare to `U` using the strict `IsEqual` helper.
2. If equal, return `Count['length']` as the current index.
3. Otherwise, recurse on `Tail` with `Count` incremented.
4. If `T` is empty, return `-1` (not found).

**Why use `IsEqual` instead of `extends`?**
Simple `extends` doesn't distinguish `any`, `never`, or literal vs. union types correctly. The `IsEqual` trick using conditional type identity is fully strict.

## Key Takeaways

- `IsEqual` via the `<T>() => T extends A ? 1 : 2` trick is the standard way to do strict equality in TypeScript types.
- Index tracking via tuple accumulator `Count` is reusable across many array-scanning problems.
