---
date: 2026-03-29
description: TypeChallenge - 0533 - Easy - Concat
title: "0533 · Concat"
readingTime: true
tag:
  - TypeScript
  - TypeChallenge
  - TC-Easy
outline: [2, 3]
article: false
---

# 0533 · Concat

[Challenge Link](https://tsch.js.org/533)

## Problem

Implement a type `Concat<T, U>` that combines two tuple or array types into one.

```ts
type Result = Concat<[1], [2]> // [1, 2]
```

## Solution

```ts
type Concat<T extends readonly unknown[], U extends readonly unknown[]> = [...T, ...U]
```

## Explanation

This challenge is a direct use of tuple spread syntax at the type level.

### Step by Step

1. `T extends readonly unknown[]` constrains the first input to an array or tuple.
2. `U extends readonly unknown[]` does the same for the second input.
3. `[...T, ...U]` creates a new tuple type by spreading both inputs in order.

### Why `readonly unknown[]`?

The challenge tests often use readonly tuples inferred from `as const`.

```ts
const a = [1, 2] as const
// typeof a = readonly [1, 2]
```

If we used `T extends unknown[]`, readonly tuples would not match. Using `readonly unknown[]` makes the type work for both mutable arrays and readonly tuples.

### Example Walkthrough

```ts
type A = Concat<[1, 2], ['a', 'b']> // [1, 2, 'a', 'b']
```

TypeScript preserves the order and literal element types from both tuples.

## Alternative Solutions

### Option 1: Mutable Array Constraint

```ts
type Concat2<T extends any[], U extends any[]> = [...T, ...U]
```

This works for many simple cases, but it is weaker because it does not accept readonly tuples.

### Option 2: Variadic Tuple Helper

```ts
type MergeTuples<A extends readonly unknown[], B extends readonly unknown[]> = [...A, ...B]
type Concat3<T extends readonly unknown[], U extends readonly unknown[]> = MergeTuples<T, U>
```

This does the same thing, but extracts the tuple merge into a reusable helper.

## Thought Process

Older tuple-manipulation problems often require recursive inference, so it is tempting to overcomplicate this one. But `Concat` is much simpler: TypeScript already supports variadic tuple types, and tuple spread does exactly what we need.

The main subtlety is not the implementation itself. It is choosing constraints that also accept readonly tuples.

**Key concepts:**
- [Variadic Tuple Types](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-4-0.html#variadic-tuple-types)
- [Tuple Types](https://www.typescriptlang.org/docs/handbook/2/objects.html#tuple-types)
