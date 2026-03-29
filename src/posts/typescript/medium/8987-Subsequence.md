---
date: 2026-03-29
description: TypeChallenge - 8987
title: Subsequence
readingTime: true
tag:
  - TypeScript
  - TypeChallenge
  - TC-Medium
outline: [2, 3]
article: false
---

# Subsequence
[Problem Link](https://tsch.js.org/8987)

## Problem

Given an array of unique elements, return all possible subsequences.

A subsequence is a sequence that can be derived from an array by deleting some or no elements without changing the order of the remaining elements.

```ts
type A = Subsequence<[1, 2]> // [] | [1] | [2] | [1, 2]
```

## Solution

### Approach: Include or Exclude Each Element

For each element, branch: either include it or skip it.

```ts
type Subsequence<T extends unknown[]> =
  T extends [infer Head, ...infer Tail]
    ? Subsequence<Tail> | [Head, ...Subsequence<Tail>]
    : T
```

**How it works:**
1. For the current `Head`, produce two branches:
   - Skip `Head`: just `Subsequence<Tail>`.
   - Include `Head`: `[Head, ...Subsequence<Tail>]`.
2. Union both branches together with `|`.
3. Base case: empty array → return `[]` (the only subsequence of an empty array).

This generates 2^N subsequences for an array of length N.

## Key Takeaways

- The include/exclude pattern is the canonical way to generate power sets in type-level TypeScript.
- Using `|` between the two recursive branches builds the union of all subsequences naturally.
- Order is preserved because we always process left-to-right without reordering elements.
