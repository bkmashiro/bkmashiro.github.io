---
date: 2026-03-29
description: TypeChallenge - 3243
title: Flatten Depth
readingTime: true
tag:
  - TypeScript
  - TypeChallenge
  - TC-Medium
outline: [2, 3]
article: false
---

# Flatten Depth
[Problem Link](https://tsch.js.org/3243)

## Problem

Recursively flatten array up to depth times.

```ts
type a = FlattenDepth<[1, 2, [3, 4], [[[5]]]], 2> // [1, 2, 3, 4, [5]]. flattern 2 times
type b = FlattenDepth<[1, 2, [3, 4], [[[5]]]]> // [1, 2, 3, 4, [[5]]]. Depth defaults to 1
```

If the depth is provided, it's guaranteed to be a positive integer.

## Solution

### Approach: Recursive Flattening with Depth Counter

We flatten one level at a time, decrementing the depth counter using a tuple accumulator.

```ts
type FlattenOnce<T extends unknown[]> = T extends [infer Head, ...infer Tail]
  ? Head extends unknown[]
    ? [...Head, ...FlattenOnce<Tail>]
    : [Head, ...FlattenOnce<Tail>]
  : []

type FlattenDepth<
  T extends unknown[],
  Depth extends number = 1,
  Count extends unknown[] = []
> = Count['length'] extends Depth
  ? T
  : FlattenDepth<FlattenOnce<T>, Depth, [...Count, unknown]>
```

**How it works:**
1. `FlattenOnce<T>` flattens the array by exactly one level.
2. `Count` is a tuple accumulator — its length tracks how many times we've flattened.
3. When `Count['length'] === Depth`, we stop and return `T`.

## Key Takeaways

- Tuple length as a counter is the canonical way to do bounded recursion in TypeScript types.
- Separating "one step" (`FlattenOnce`) from "repeat N times" keeps the logic clean.
