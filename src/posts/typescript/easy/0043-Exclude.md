---
date: 2024-08-18
description: TypeChallenge - 0043 - Easy - Exclude
title: "0043 · Exclude"
readingTime: true
tag:
  - TypeScript
  - TypeChallenge
  - TC-Easy
outline: [2, 3]
article: false
---

# 0043 · Exclude

[Challenge Link](https://tsch.js.org/43)

## Problem

Implement the built-in `Exclude<T, U>` generic without using it.

> Exclude from `T` those types that are assignable to `U`.

```ts
type Result = MyExclude<'a' | 'b' | 'c', 'a'>
// expected: 'b' | 'c'
```

## Solution

```ts
type MyExclude<T, U> = T extends U ? never : T
```

## Explanation

This is a one-liner that leverages one of TypeScript's most powerful features: **distributive conditional types**.

### Distributive Conditional Types

When you write `T extends U ? A : B` and `T` is a **naked type parameter** (i.e., not wrapped in `[]`, `{}`, etc.), TypeScript automatically **distributes** the conditional over each member of a union type:

```ts
type MyExclude<T, U> = T extends U ? never : T

// With T = 'a' | 'b' | 'c' and U = 'a':
// Distributes to:
//   ('a' extends 'a' ? never : 'a')   → never
// | ('b' extends 'a' ? never : 'b')   → 'b'
// | ('c' extends 'a' ? never : 'c')   → 'c'
// Result: never | 'b' | 'c' → 'b' | 'c'
```

### Why `never` is the Right "Remove" Signal

`never` is TypeScript's bottom type — it represents an impossible value. In a union, `never` is automatically eliminated:

```ts
type T = never | 'b' | 'c'  // simplifies to 'b' | 'c'
```

So using `never` in the true branch of the conditional effectively removes that member from the union.

### Step by Step

1. `T extends U ? never : T` — for each member of `T`:
   - If the member is assignable to `U` → replace it with `never` (remove it)
   - Otherwise → keep it as is
2. The resulting union has all `never`s filtered out automatically
3. What remains is the original `T` minus anything in `U`

### Non-Distributive Comparison

If `T` were wrapped (e.g., `[T] extends [U]`), distribution would not happen:

```ts
type NonDistributive<T, U> = [T] extends [U] ? never : T
// NonDistributive<'a' | 'b' | 'c', 'a'>
// → ['a' | 'b' | 'c'] extends ['a'] ? never : 'a' | 'b' | 'c'
// → 'a' | 'b' | 'c'  (the whole union doesn't extend ['a'])
```

This is why the naked type parameter `T` (no wrapping) is essential for `Exclude` to work correctly.

**Key concepts:**
- [Distributive Conditional Types](https://www.typescriptlang.org/docs/handbook/2/conditional-types.html#distributive-conditional-types) — how TypeScript distributes over union members
- `never` in unions — always simplified away, acting as the identity element for union types
