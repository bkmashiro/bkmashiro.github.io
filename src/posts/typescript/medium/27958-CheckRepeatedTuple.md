---
date: 2024-08-18
description: TypeChallenge - 27958
title: CheckRepeatedTuple
readingTime: true
tag:
  - TypeScript
  - TypeChallenge
  - TC-Medium
outline: [2, 3]
article: false
---

# CheckRepeatedTuple
[Problem Link](https://tsch.js.org/27958)

## Problem

Check whether a tuple contains duplicate elements. Return `true` if there are any duplicates, `false` otherwise.

```ts
type T0 = CheckRepeatedTuple<[1, 2, 3]>      // false
type T1 = CheckRepeatedTuple<[1, 2, 1]>      // true
type T2 = CheckRepeatedTuple<[1, 2, 3, '3']> // false
```

## Solution

```ts
type Includes<T extends unknown[], U> =
  T extends [infer First, ...infer Rest]
    ? [First] extends [U]
      ? [U] extends [First]
        ? true
        : Includes<Rest, U>
      : Includes<Rest, U>
    : false

type CheckRepeatedTuple<T extends unknown[]> =
  T extends [infer First, ...infer Rest]
    ? Includes<Rest, First> extends true
      ? true
      : CheckRepeatedTuple<Rest>
    : false
```

**How it works:**
1. For each element `First`, check whether it already appears in the remaining elements `Rest` using `Includes`.
2. If found, return `true` immediately.
3. Otherwise, recurse on `Rest`.
4. If we exhaust the tuple without a duplicate, return `false`.

`Includes` uses the bidirectional `[X] extends [Y]` trick for exact equality to avoid issues with `boolean` (which is `true | false`).

## Key Takeaways

- This is essentially an O(n²) set-membership check implemented recursively.
- Checking `Rest` (tail) rather than `Seen` (head) avoids needing a separate accumulator.
- The exact-equality check `[A] extends [B] && [B] extends [A]` is important to distinguish `1` from `number`.
