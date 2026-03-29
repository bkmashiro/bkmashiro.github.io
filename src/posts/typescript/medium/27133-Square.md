---
date: 2024-08-18
description: TypeChallenge - 27133
title: Square
readingTime: true
tag:
  - TypeScript
  - TypeChallenge
  - TC-Medium
outline: [2, 3]
article: false
---

# Square
[Problem Link](https://tsch.js.org/27133)

## Problem

Given a number `N`, return its square.

```ts
type T0 = Square<0>  // 0
type T1 = Square<1>  // 1
type T2 = Square<3>  // 9
type T3 = Square<-3> // 9  (square of absolute value)
```

## Solution

```ts
// Build a tuple of length N
type BuildTuple<N extends number, T extends unknown[] = []> =
  T['length'] extends N ? T : BuildTuple<N, [...T, unknown]>

// Absolute value for number type (handles negatives via string)
type Abs<N extends number> =
  `${N}` extends `-${infer P extends number}` ? P : N

// Concatenate two tuples and return length = A + B
type Add<A extends number, B extends number> =
  [...BuildTuple<A>, ...BuildTuple<B>]['length']

// Repeat addition B times: A * B
type Multiply<
  A extends number,
  B extends number,
  Count extends unknown[] = [],
  Acc extends unknown[] = []
> =
  Count['length'] extends B
    ? Acc['length']
    : Multiply<A, B, [...Count, unknown], [...Acc, ...BuildTuple<A>]>

type Square<N extends number> = Multiply<Abs<N>, Abs<N>>
```

**How it works:**
1. `Abs<N>` strips a leading `-` from the string representation to get the positive value.
2. `BuildTuple<N>` constructs a tuple of length `N` for use in arithmetic.
3. `Multiply<A, B>` accumulates `A` copies of a length-`A` tuple, iterating `B` times.
4. `Square<N>` calls `Multiply<Abs<N>, Abs<N>>`.

**Limitation:** Works for small numbers due to TypeScript's recursion depth limit.

## Key Takeaways

- Type-level multiplication is repeated addition; addition is tuple concatenation.
- Handling negatives: convert to string, strip `-`, parse back with `infer N extends number`.
- For larger numbers a string-digit approach is needed, but tuple arithmetic is cleaner for small inputs.
