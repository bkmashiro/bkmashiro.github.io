---
date: 2024-08-18
description: TypeChallenge - 0014 - Easy - First of Array
title: "0014 · First of Array"
readingTime: true
tag:
  - TypeScript
  - TypeChallenge
  - TC-Easy
outline: [2, 3]
article: false
---

# 0014 · First of Array

[Challenge Link](https://tsch.js.org/14)

## Problem

Implement a generic `First<T>` that takes an array `T` and returns its first element's type.

```ts
type arr1 = ['a', 'b', 'c']
type arr2 = [3, 2, 1]

type head1 = First<arr1> // expected to be 'a'
type head2 = First<arr2> // expected to be 3
```

## Solution

```ts
// Option 1: Conditional type approach
type First<T extends any[]> = T extends [] ? never : T[0]

// Option 2: Infer approach
type First<T extends readonly any[]> = T extends [infer F, ...infer R] ? F : never
```

## Explanation

### Naive Approach and Its Problem

The simplest idea is to just index the first element:

```ts
type First<T extends any[]> = T[0]
```

This works for non-empty arrays, but when `T` is an empty array `[]`, `T[0]` resolves to `undefined` instead of `never`. The test cases expect `never` for empty arrays.

### Option 1: Conditional Type Guard

```ts
type First<T extends any[]> = T extends [] ? never : T[0]
```

We explicitly check if `T` is an empty array. If it is, return `never`; otherwise return `T[0]`.

**Step by step:**
1. `T extends any[]` — constrains `T` to be an array type
2. `T extends []` — checks if `T` is the empty tuple type
3. If empty → `never`; otherwise → `T[0]` (the first element)

### Option 2: The `infer` Keyword

```ts
type First<T extends readonly any[]> = T extends [infer F, ...infer R] ? F : never
```

This uses the `infer` keyword to **pattern-match** the tuple structure:

- `[infer F, ...infer R]` matches any non-empty tuple, binding the first element to `F` and the rest to `R`
- If `T` matches (i.e., it's non-empty), return `F`
- If `T` is empty, the pattern doesn't match → return `never`

> The `infer` keyword introduces a new type variable within a conditional type, letting TypeScript infer it from the matched structure.

::: tip
`readonly any[]` is used instead of `any[]` so that the type works for both regular arrays and readonly tuples. A regular array is a subtype of a readonly array, so `readonly any[]` is the more general constraint.
:::

**Key concepts:**
- [Conditional Types](https://www.typescriptlang.org/docs/handbook/2/conditional-types.html) — `T extends U ? A : B`
- [Inferring Within Conditional Types](https://www.typescriptlang.org/docs/handbook/2/conditional-types.html#inferring-within-conditional-types) — the `infer` keyword
