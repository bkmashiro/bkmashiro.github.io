---
date: 2024-08-18
description: TypeChallenge - 25170
title: Replace First
readingTime: true
tag:
  - TypeScript
  - TypeChallenge
  - TC-Medium
outline: [2, 3]
article: false
---

# Replace First
[Problem Link](https://tsch.js.org/25170)

## Problem

Implement the type `ReplaceFirst<T, S, R>` which will replace the first occurrence of `S` in a tuple type `T` with `R`. If no `S` is found in `T`, `T` is returned unchanged.

```ts
type T0 = ReplaceFirst<[1, 2, 3], 3, 4>    // [1, 2, 4]
type T1 = ReplaceFirst<[1, 2, 3], 1, 4>    // [4, 2, 3]
type T2 = ReplaceFirst<[1, 2, 3], 5, 0>    // [1, 2, 3]
type T3 = ReplaceFirst<[1, 2, 2, 3], 2, 4> // [1, 4, 2, 3] — only first occurrence
```

## Solution

```ts
type ReplaceFirst<T extends readonly unknown[], S, R, Found extends boolean = false> =
  T extends [infer First, ...infer Rest]
    ? Found extends true
      ? [First, ...ReplaceFirst<Rest, S, R, true>]
      : [First] extends [S]
        ? [S] extends [First]
          ? [R, ...ReplaceFirst<Rest, S, R, true>]
          : [First, ...ReplaceFirst<Rest, S, R, false>]
        : [First, ...ReplaceFirst<Rest, S, R, false>]
    : []
```

**How it works:**
1. Traverse the tuple element by element.
2. Use the `Found` flag to track whether a replacement has already been made.
3. Once `Found` is `true`, copy remaining elements unchanged.
4. For the equality check, use `[First] extends [S]` **and** `[S] extends [First]` (wrapped in `[]` to avoid distribution) to perform an exact match.
5. On the first match, emit `R` and set `Found` to `true`.

## Key Takeaways

- A boolean accumulator (`Found`) cleanly implements "only the first occurrence" semantics without extra complexity.
- Bidirectional `extends` wrapped in `[]` is the standard exact-equality check for conditional types.
- Once `Found = true`, the rest of the recursion is just a copy — no more comparisons needed.
