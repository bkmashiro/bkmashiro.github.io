---
date: 2026-03-29
description: TypeChallenge - 3312 - Easy - Parameters
title: "3312 · Parameters"
readingTime: true
tag:
  - TypeScript
  - TypeChallenge
  - TC-Easy
outline: [2, 3]
article: false
---

# 3312 · Parameters

[Challenge Link](https://tsch.js.org/3312)

## Problem

Implement the built-in `Parameters<T>` generic without using it.

```ts
const foo = (arg1: string, arg2: number): void => {}

type FunctionParamsType = MyParameters<typeof foo> // [string, number]
```

## Solution

```ts
type MyParameters<T extends (...args: any[]) => any> =
  T extends (...args: infer P) => any ? P : never
```

## Explanation

We use `infer` inside a conditional type to capture the parameter list of function type `T`.

**Step by step:**
1. `T extends (...args: any[]) => any` — constrains `T` to any function type
2. `T extends (...args: infer P) => any` — tries to match `T` as a function; if it matches, `infer P` captures the rest parameter tuple
3. `? P : never` — if matched, return `P` (the parameter types as a tuple); otherwise `never`

The key insight is that `...args` always captures parameters as a tuple, so `infer P` gives us exactly the tuple of parameter types.

**Key concepts:**
- [`infer` keyword](https://www.typescriptlang.org/docs/handbook/2/conditional-types.html#inferring-within-conditional-types) — captures a type within a conditional type pattern
- This is exactly how the built-in `Parameters<T>` utility is implemented in TypeScript's lib
