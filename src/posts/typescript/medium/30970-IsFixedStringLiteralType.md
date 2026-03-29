---
date: 2024-08-18
description: TypeChallenge - 30970
title: IsFixedStringLiteralType
readingTime: true
tag:
  - TypeScript
  - TypeChallenge
  - TC-Medium
outline: [2, 3]
article: false
---

# IsFixedStringLiteralType
[Problem Link](https://tsch.js.org/30970)

## Problem

Determine if a type is a fixed (non-template) string literal type.

```ts
type T0 = IsFixedStringLiteralType<'foo'>          // true
type T1 = IsFixedStringLiteralType<string>         // false
type T2 = IsFixedStringLiteralType<`${string}`>    // false  (template literal = not fixed)
type T3 = IsFixedStringLiteralType<`foo`>          // true   (no interpolation = fixed)
type T4 = IsFixedStringLiteralType<'foo' | 'bar'>  // boolean (distributes)
type T5 = IsFixedStringLiteralType<number>         // false
```

## Solution

```ts
type IsFixedStringLiteralType<T extends string> =
  string extends T
    ? false
    : T extends `${infer _Head}${infer _Tail}`
      ? _Head extends string
        ? _Tail extends ''
          ? true
          : IsFixedStringLiteralType<_Tail>
        : false
      : T extends ''
        ? true
        : false
```

A simpler approach:

```ts
type IsFixedStringLiteralType<T extends string> =
  [T] extends [never]
    ? false
    : string extends T
      ? false
      : T extends `${string & {}}${infer _}`
        ? false
        : true
```

Most concise approach:

```ts
type IsFixedStringLiteralType<T extends string> =
  string extends T ? false : `_${T}` extends `_${string & {}}` ? false : true
```

**How it works:**
1. `string extends T` — if `T` is the broad `string` type, return `false`.
2. Template literal types with interpolated `string` (like `` `${string}` ``) are not fixed literals.
3. A plain string literal like `'foo'` is narrower than `string`, and concatenating a prefix `_` doesn't produce a template-literal-type — so the check distinguishes fixed from template literals.

## Key Takeaways

- `string extends T` checks if `T` is the widened `string` type (not a literal).
- Template literal types with open interpolations (`${string}`) are structurally distinct from fixed literals.
- `string & {}` is a trick to get a non-widening `string` type for pattern matching purposes.
