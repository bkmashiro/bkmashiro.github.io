---
date: 2024-08-18
description: TypeChallenge - 25270
title: Transpose
readingTime: true
tag:
  - TypeScript
  - TypeChallenge
  - TC-Medium
outline: [2, 3]
article: false
---

# Transpose
[Problem Link](https://tsch.js.org/25270)

## Problem

The transpose of a matrix is obtained by flipping a matrix over its diagonal, switching its row and column indices.

```ts
type Matrix = Transpose<[[1, 2, 3], [4, 5, 6], [7, 8, 9]]>
// [[1, 4, 7], [2, 5, 8], [3, 6, 9]]
```

## Solution

```ts
type Transpose<M extends number[][]> =
  M extends [infer First extends number[], ...infer Rest extends number[][]]
    ? First extends [infer _, ...infer ___]
      ? {
          [K in keyof First]: [
            First[K & keyof First],
            ...Transpose<Rest>[K & keyof Transpose<Rest>]
          ]
        }[keyof First] extends infer R
        ? R extends any[]
          ? R[]
          : never
        : never
      : []
    : []
```

A cleaner approach using index-based column extraction:

```ts
type ColAt<M extends any[][], I extends number> = {
  [K in keyof M]: M[K][I]
}

type Transpose<M extends any[][]> =
  M extends []
    ? []
    : M[0] extends []
      ? []
      : {
          [I in keyof M[0]]: ColAt<M, I & number>
        }
```

**How it works:**
1. `M[0]` gives the first row — its indices are the column indices of the matrix.
2. For each column index `I`, build a tuple by collecting `M[K][I]` for every row `K`.
3. `ColAt<M, I>` uses a mapped type over `keyof M` (row indices) to gather the `I`-th element from every row.
4. Mapping over `keyof M[0]` produces one output row per original column.

## Key Takeaways

- Transpose maps `M[row][col]` → `M[col][row]`, so the output has `M[0].length` rows and `M.length` columns.
- Using `keyof M[0]` as the outer iterator elegantly handles rectangular matrices.
- `ColAt` is a reusable "slice a column" helper that collects the same index across all rows.
