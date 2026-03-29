---
date: 2026-03-29
description: TypeChallenge - 8767
title: Combination
readingTime: true
tag:
  - TypeScript
  - TypeChallenge
  - TC-Medium
outline: [2, 3]
article: false
---

# Combination
[Problem Link](https://tsch.js.org/8767)

## Problem

Given an array of strings, do Permutation & Combination.
It's also useful for the `Vuex` binding helpers.

```ts
type Keys = Combination<['foo', 'bar', 'baz']>
// 'foo' | 'bar' | 'baz' | 'foo bar' | 'foo baz' | 'bar baz' | 'foo bar baz' ...
```

## Solution

### Approach: Union Distribution with Exclusion

Convert the array to a union, then for each element, combine it with all sub-combinations of the remaining elements.

```ts
type Combination<T extends string[], U extends string = T[number]> =
  U extends string
    ? U | `${U} ${Combination<[], Exclude<U, U>> }` | `${U} ${string & Exclude<T[number], U>}`
    : never
```

A cleaner version:

```ts
type Combination<
  T extends string[],
  All extends string = T[number],
  U extends string = All
> = U extends All
  ? U | `${U} ${Combination<[], Exclude<All, U>>}`
  : never
```

**How it works:**
1. `T[number]` converts the tuple to a string union `All`.
2. Distribute over each member `U` of `All`.
3. For each `U`, produce `U` alone or `U` followed by space and a combination of the remaining items.
4. `Exclude<All, U>` removes the current item to avoid repeats.

## Key Takeaways

- Converting a tuple to a union with `T[number]` is often the first step in combination/permutation problems.
- The recursive call uses `Exclude` to shrink the available set — "choose each item at most once".
- Distributing over a union with `U extends All` generates all possible choices in parallel.
