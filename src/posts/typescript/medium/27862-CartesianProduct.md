---
date: 2024-08-18
description: TypeChallenge - 27862
title: CartesianProduct
readingTime: true
tag:
  - TypeScript
  - TypeChallenge
  - TC-Medium
outline: [2, 3]
article: false
---

# CartesianProduct
[Problem Link](https://tsch.js.org/27862)

## Problem

Given two sets (union types) `T` and `U`, return their Cartesian product as a union of tuples.

```ts
type T = CartesianProduct<1 | 2, 'a' | 'b'>
// [1, 'a'] | [1, 'b'] | [2, 'a'] | [2, 'b']
```

## Solution

```ts
type CartesianProduct<T, U> =
  T extends T
    ? U extends U
      ? [T, U]
      : never
    : never
```

**How it works:**
1. `T extends T` distributes the conditional type over each member of union `T`.
2. Inside, `U extends U` distributes over each member of union `U`.
3. For each combination `(T, U)`, emit the tuple `[T, U]`.
4. The resulting union of all such tuples is the Cartesian product.

## Key Takeaways

- Double distribution over two unions (`T extends T ? U extends U ? ...`) is the idiomatic way to compute a Cartesian product in TypeScript's type system.
- The expression `T extends T` looks trivially true, but its purpose is to trigger distributive conditional type behavior over each union member.
- This is one of the most concise patterns in type-level TypeScript.
