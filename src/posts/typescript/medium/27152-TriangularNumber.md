---
date: 2024-08-18
description: TypeChallenge - 27152
title: Triangular Number
readingTime: true
tag:
  - TypeScript
  - TypeChallenge
  - TC-Medium
outline: [2, 3]
article: false
---

# Triangular Number
[Problem Link](https://tsch.js.org/27152)

## Problem

Given a number `N`, return the `N`-th triangular number: `T(N) = 1 + 2 + ... + N`.

```ts
type T0 = TriangularNumber<0>  // 0
type T1 = TriangularNumber<1>  // 1
type T2 = TriangularNumber<3>  // 6   (1+2+3)
type T3 = TriangularNumber<10> // 55
```

## Solution

```ts
type TriangularNumber<
  N extends number,
  Count extends unknown[] = [],
  Acc extends unknown[] = []
> =
  Count['length'] extends N
    ? Acc['length']
    : TriangularNumber<
        N,
        [...Count, unknown],
        [...Acc, ...Count, unknown]   // add (Count.length + 1) each iteration
      >
```

**How it works:**
1. `Count` tracks how many steps have been taken (0, 1, 2, …).
2. Each step, we add `Count.length + 1` to `Acc` by spreading `Count` and appending one more element.
3. When `Count.length === N`, `Acc.length` is `1 + 2 + ... + N`.

Example for `N = 3`:
- Step 0 → Acc length = 0, add 1 → 1
- Step 1 → Acc length = 1, add 2 → 3
- Step 2 → Acc length = 3, add 3 → 6 ✓

## Key Takeaways

- Tuple length arithmetic lets you accumulate sums without string-based parsing.
- The key insight: at iteration `i` (0-indexed), `Count.length` is `i`, so `[...Acc, ...Count, unknown]` adds `i+1` elements.
- This approach cleanly computes `sum(1..N)` in exactly `N` recursive steps.
