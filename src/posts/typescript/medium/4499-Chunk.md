---
date: 2026-03-29
description: TypeChallenge - 4499
title: Chunk
readingTime: true
tag:
  - TypeScript
  - TypeChallenge
  - TC-Medium
outline: [2, 3]
article: false
---

# Chunk
[Problem Link](https://tsch.js.org/4499)

## Problem

Do you know `lodash`? `Chunk` is a very useful function in it, now let's implement it.
`Chunk<T, N>` accepts two required type parameters, the `T` must be a tuple, and the `N` must be an integer ≥ 1.

```ts
type exp1 = Chunk<[1, 2, 3], 2>    // [[1, 2], [3]]
type exp2 = Chunk<[1, 2, 3], 4>    // [[1, 2, 3]]
type exp3 = Chunk<[], 0>            // []
```

## Solution

### Approach: Accumulate a Current Chunk

Use a `Current` accumulator tuple. When it fills to size `N`, flush it into the result.

```ts
type Chunk<
  T extends unknown[],
  N extends number,
  Current extends unknown[] = []
> = T extends [infer Head, ...infer Tail]
  ? Current['length'] extends N
    ? [Current, ...Chunk<T, N>]
    : Chunk<Tail, N, [...Current, Head]>
  : Current extends []
    ? []
    : [Current]
```

**How it works:**
1. Pull `Head` from `T`.
2. If `Current` already has `N` elements, flush `Current` and start a new chunk (restart with full `T`).
3. Otherwise, add `Head` to `Current` and continue.
4. When `T` is empty: if `Current` is non-empty, emit it as the last chunk; otherwise emit `[]`.

## Key Takeaways

- The "flush when full" pattern is clean for chunking: check length before adding.
- Restarting recursion with the original `T` (not `Tail`) when flushing avoids consuming `Head` twice.
- Empty tuple detection uses `Current extends []` — checking against the empty literal.
