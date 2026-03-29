---
date: 2024-08-18
description: TypeChallenge - 10969
title: Integer
readingTime: true
tag:
  - TypeScript
  - TypeChallenge
  - TC-Medium
outline: [2, 3]
article: false
---

# Integer
[Problem Link](https://tsch.js.org/10969)

## Problem

Please complete type `Integer<T>`, which takes a type `T` and returns the integer part.

```ts
type Res1 = Integer<1>        // 1
type Res2 = Integer<1.1>      // 1
type Res3 = Integer<1.9>      // 1
type Res4 = Integer<-1.9>     // -1
type Res5 = Integer<'string'> // never
```

## Solution

```ts
type Integer<T extends number | string> =
  `${T}` extends `${infer Int}.${string}`
    ? Int extends `${infer N extends number}`
      ? N
      : never
    : `${T}` extends `${infer N extends number}`
      ? N
      : never
```

**How it works:**
1. Convert `T` to a string template literal.
2. If it contains a `.`, the part before the dot is the integer portion.
3. If no `.`, the number is already an integer — return it as-is.
4. Use `infer N extends number` (TS 4.8+) to parse the string fragment back to a numeric type.
5. Non-numeric strings like `'string'` fail the pattern match and return `never`.

## Key Takeaways

- Template literal `\`${T}\`` converts both numbers and numeric strings to a string for pattern matching.
- `infer N extends number` is the idiomatic way to parse a numeric string back to a number type.
- Splitting on `.` gives the integer and fractional parts without any arithmetic.
