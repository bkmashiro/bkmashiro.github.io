---
date: 2024-08-18
description: TypeChallenge - 17973
title: DeepMutable
readingTime: true
tag:
  - TypeScript
  - TypeChallenge
  - TC-Medium
outline: [2, 3]
article: false
---

# DeepMutable
[Problem Link](https://tsch.js.org/17973)

## Problem

Implement a generic `DeepMutable<T>` which make every parameter of an object — and its sub-objects recursively — mutable.

```ts
type X = {
  readonly title: string
  readonly settings: {
    readonly speed: number
    readonly resolution: { readonly width: number }
  }
}

type Expected = {
  title: string
  settings: {
    speed: number
    resolution: { width: number }
  }
}

type Todo = DeepMutable<X> // Expected
```

## Solution

```ts
type DeepMutable<T extends object> = {
  -readonly [K in keyof T]: T[K] extends object
    ? DeepMutable<T[K]>
    : T[K]
}
```

**How it works:**
1. `-readonly` removes the `readonly` modifier from every key.
2. If the value type is itself an object, recurse with `DeepMutable`.
3. Primitive values are kept as-is.

Note: Functions satisfy `extends object` but we typically don't want to recurse into them. For safety you can add a function guard:

```ts
type DeepMutable<T extends object> = {
  -readonly [K in keyof T]: T[K] extends (...args: any[]) => any
    ? T[K]
    : T[K] extends object
      ? DeepMutable<T[K]>
      : T[K]
}
```

## Key Takeaways

- `-readonly` is the mapped type modifier that strips readonly — the counterpart to adding `readonly`.
- Deep recursive mapped types follow the same pattern: check if a value is an object, then recurse.
- This is the inverse of `DeepReadonly`.
