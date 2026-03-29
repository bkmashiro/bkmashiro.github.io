---
date: 2024-08-18
description: TypeChallenge - 16259
title: ToPrimitive
readingTime: true
tag:
  - TypeScript
  - TypeChallenge
  - TC-Medium
outline: [2, 3]
article: false
---

# ToPrimitive
[Problem Link](https://tsch.js.org/16259)

## Problem

Convert a property value recursively into a primitive type.

```ts
type X = {
  name: 'Tom',
  age: 30,
  married: false,
  info: {
    additional1: null,
    additional2: undefined
  }
}

type Expected = {
  name: string,
  age: number,
  married: boolean,
  info: {
    additional1: null,
    additional2: undefined
  }
}

type Todo = ToPrimitive<X> // Expected
```

## Solution

```ts
type ToPrimitive<T> =
  T extends object
    ? T extends (...args: any[]) => any
      ? Function
      : { [K in keyof T]: ToPrimitive<T[K]> }
    : T extends string
      ? string
      : T extends number
        ? number
        : T extends boolean
          ? boolean
          : T extends symbol
            ? symbol
            : T extends bigint
              ? bigint
              : T
```

**How it works:**
1. If `T` is a function, map it to `Function`.
2. If `T` is an object (non-function), recursively map each property.
3. For primitives, widen the literal type to its base primitive (`'Tom'` → `string`, `30` → `number`, etc.).
4. `null` and `undefined` fall through to `T` unchanged.

## Key Takeaways

- Check for function before checking for object because functions satisfy `T extends object`.
- The chain of primitive checks (`extends string ? string : ...`) widens literal types to their base.
- `null` and `undefined` do **not** extend `string | number | boolean | symbol | bigint`, so they are returned as-is.
