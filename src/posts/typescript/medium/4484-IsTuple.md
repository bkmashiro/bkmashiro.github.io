---
date: 2026-03-29
description: TypeChallenge - 4484
title: IsTuple
readingTime: true
tag:
  - TypeScript
  - TypeChallenge
  - TC-Medium
outline: [2, 3]
article: false
---

# IsTuple
[Problem Link](https://tsch.js.org/4484)

## Problem

Implement a type `IsTuple`, which takes an input type `T` and returns whether `T` is tuple type.

```ts
type case1 = IsTuple<[number]>      // true
type case2 = IsTuple<readonly [number]> // true
type case3 = IsTuple<number[]>      // false
```

## Solution

### Approach: Check for Finite Length

A tuple has a fixed, finite `length` (a numeric literal), while an array has `number` as its length.

```ts
type IsTuple<T> =
  T extends readonly unknown[]
    ? number extends T['length']
      ? false
      : true
    : false
```

**How it works:**
1. First confirm `T` is array-like (`readonly unknown[]`).
2. Check `T['length']`: for arrays it's `number`, for tuples it's a numeric literal like `0 | 1 | 2`.
3. `number extends T['length']` is `true` only when `T['length']` is exactly `number` — i.e., it's an array, not a tuple.

## Key Takeaways

- The key insight: `number extends 3` is `false`, but `number extends number` is `true`.
- `readonly unknown[]` is the widest array type and accepts both mutable and readonly tuples/arrays.
- This pattern — checking whether a length is a literal vs. `number` — appears in many tuple-detection scenarios.
