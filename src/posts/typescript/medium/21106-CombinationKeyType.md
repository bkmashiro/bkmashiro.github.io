---
date: 2024-08-18
description: TypeChallenge - 21106
title: Combination key type
readingTime: true
tag:
  - TypeScript
  - TypeChallenge
  - TC-Medium
outline: [2, 3]
article: false
---

# Combination key type
[Problem Link](https://tsch.js.org/21106)

## Problem

Combine multiple modifier strings with a union type into a new type. The order doesn't matter.

```ts
// input
type Key = 'cmd' | 'ctrl' | 'opt' | 'fn'

// output — all non-empty combinations joined with '+'
type CombinationKeyType<T extends string> = ... // e.g. 'cmd', 'cmd+ctrl', 'cmd+ctrl+opt', ...
```

## Solution

```ts
type Combination<T extends string, U extends string = T> =
  T extends any
    ? T | `${T}+${Combination<Exclude<U, T>>}`
    : never

type CombinationKeyType<T extends string> = Combination<T>
```

**How it works:**
1. Distribute over `T` — for each member `T` we produce:
   - `T` alone (single key)
   - `T + '+' + (combination of remaining keys)` — recursion excludes the current key to avoid repetition.
2. `Exclude<U, T>` removes the current key from the pool so we never use the same key twice.
3. When the excluded pool is empty, `Combination<never>` resolves to `never`, terminating the recursion.

## Key Takeaways

- Distributing over a union (`T extends any ? ... : never`) is the standard way to process each member.
- Keeping a separate `U` parameter for the full union while distributing on `T` lets us do `Exclude<U, T>` cleanly.
- The recursion naturally generates all ordered subsets; since `+` is the separator, `'a+b'` and `'b+a'` are distinct types — which is intentional for key combinations.
