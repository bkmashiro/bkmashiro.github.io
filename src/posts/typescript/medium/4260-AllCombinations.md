---
date: 2026-03-29
description: TypeChallenge - 4260
title: All Combinations
readingTime: true
tag:
  - TypeScript
  - TypeChallenge
  - TC-Medium
outline: [2, 3]
article: false
---

# All Combinations
[Problem Link](https://tsch.js.org/4260)

## Problem

Implement type `AllCombinations<S>` that return all combinations of strings which use characters from `S` at most once.

```ts
type AllCombinations_ABC = AllCombinations<'ABC'>
// should be '' | 'A' | 'B' | 'C' | 'AB' | 'AC' | 'BA' | 'BC' | 'CA' | 'CB' | 'ABC' | 'ACB' | 'BAC' | 'BCA' | 'CAB' | 'CBA'
```

## Solution

### Approach: Union-Based Permutation

First convert the string to a union of individual characters, then build all permutations recursively.

```ts
// Convert string to union of characters
type StringToUnion<S extends string> =
  S extends `${infer C}${infer Rest}` ? C | StringToUnion<Rest> : never

// Generate all combinations (each char used at most once)
type AllCombinations<
  S extends string,
  U extends string = StringToUnion<S>
> = [U] extends [never]
  ? ''
  : '' | {
      [C in U]: `${C}${AllCombinations<never, Exclude<U, C>>}`
    }[U]
```

**How it works:**
1. `StringToUnion` converts `'ABC'` → `'A' | 'B' | 'C'`.
2. For each character `C` in union `U`, we prepend `C` to every combination built from the remaining characters `Exclude<U, C>`.
3. We always include `''` (empty string) as a valid combination.
4. The mapped type `{ [C in U]: ... }[U]` distributes over all union members.

## Key Takeaways

- `Exclude<U, C>` removes a specific member from a union — essential for "use each item at most once" problems.
- Distributing over a union with `{ [K in U]: ... }[U]` is the type-level equivalent of `Array.flatMap`.
- Including `''` in the base case ensures the empty combination is always valid.
