---
date: 2024-08-18
description: TypeChallenge - 18220
title: Filter
readingTime: true
tag:
  - TypeScript
  - TypeChallenge
  - TC-Medium
outline: [2, 3]
article: false
---

# Filter
[Problem Link](https://tsch.js.org/18220)

## Problem

Implement the type `Filter<T, Predicate>` which filters out elements from a tuple `T` that do not satisfy the `Predicate` type.

```ts
type Filtered = Filter<[1, 2, 3, 'a', 'b', 1], number> // [1, 2, 3, 1]
```

## Solution

```ts
type Filter<T extends any[], P> =
  T extends [infer First, ...infer Rest]
    ? First extends P
      ? [First, ...Filter<Rest, P>]
      : Filter<Rest, P>
    : []
```

**How it works:**
1. Recursively destructure the tuple into `First` and `Rest`.
2. If `First extends P`, keep it in the output tuple.
3. Otherwise, skip it and continue with `Rest`.
4. Base case: empty tuple returns `[]`.

## Key Takeaways

- The standard "recursive tuple filter" pattern in TypeScript type-land mirrors `Array.prototype.filter` at the type level.
- `First extends P` is a subtype check — it keeps elements that are assignable to `P`.
- Building the result with `[First, ...Filter<Rest, P>]` preserves tuple structure and element types.
