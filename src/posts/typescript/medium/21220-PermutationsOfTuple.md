---
date: 2024-08-18
description: TypeChallenge - 21220
title: Permutations of Tuple
readingTime: true
tag:
  - TypeScript
  - TypeChallenge
  - TC-Medium
outline: [2, 3]
article: false
---

# Permutations of Tuple
[Problem Link](https://tsch.js.org/21220)

## Problem

Given a generic tuple type `T extends unknown[]`, write a type which produces all permutations of `T` as a union.

```ts
PermutationsOfTuple<[1, 2, 3]>
// [1, 2, 3] | [1, 3, 2] | [2, 1, 3] | [2, 3, 1] | [3, 1, 2] | [3, 2, 1]
```

## Solution

```ts
type PermutationsOfTuple<
  T extends unknown[],
  Prefix extends unknown[] = []
> =
  T extends [infer First, ...infer Rest]
    ?
      | PermutationsOfTuple<Rest, [...Prefix, First]>
      | (Rest extends [] ? never : PermutationsOfTuple<[...Rest, First], Prefix>)
    : Prefix

```

A cleaner alternative using "pick one element" recursion:

```ts
type PrependToAll<T, U extends any[][]> =
  U extends [infer First extends any[], ...infer Rest extends any[][]]
    ? [[T, ...First], ...PrependToAll<T, Rest>]
    : []

type PermutationsOfTuple<T extends unknown[]> =
  T extends [infer First, ...infer Rest]
    ? [...PrependToAll<First, PermutationsOfTuple<Rest>>, ...PermutationsOfTuple<Rest extends [] ? never : [...Rest, First]>]
    : [T]
```

Simplest readable approach:

```ts
type PermutationsOfTuple<T extends unknown[], R extends unknown[] = []> =
  T extends [infer F, ...infer L]
    ? PermutationsOfTuple<L, [...R, F]> | PermutationsOfTuple<[...L, F], R>
    : R
```

**How it works:**
1. At each step, pick the first element `F` and either:
   - Include it at the end of the accumulated prefix `R`, then recurse on `L`.
   - Move it to the end of remaining `L`, then recurse — effectively trying all positions.
2. When `T` is empty, `R` is a complete permutation — add it to the union.

## Key Takeaways

- Generating permutations requires distributing choices across recursive branches (union of recursive calls).
- Rotating elements (`[...L, F]`) is a classic way to visit all positions without explicit indexing.
- The result is a **union of tuples**, not a union of elements.
