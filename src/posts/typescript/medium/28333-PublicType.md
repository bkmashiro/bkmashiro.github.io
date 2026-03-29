---
date: 2024-08-18
description: TypeChallenge - 28333
title: Public Type
readingTime: true
tag:
  - TypeScript
  - TypeChallenge
  - TC-Medium
outline: [2, 3]
article: false
---

# Public Type
[Problem Link](https://tsch.js.org/28333)

## Problem

Remove the key-value pairs that start with an underscore (`_`) from an object type.

```ts
type T = PublicType<{ _name: string; _age: number; email: string }>
// { email: string }
```

## Solution

```ts
type PublicType<T extends object> = {
  [K in keyof T as K extends `_${string}` ? never : K]: T[K]
}
```

**How it works:**
1. Use a mapped type with key remapping (`as`).
2. For each key `K`, check if it matches the template literal `` `_${string}` ``.
3. If it starts with `_`, remap to `never` — which removes the key from the output.
4. Otherwise keep the key as-is.

## Key Takeaways

- Key remapping with `as` and `never` is the idiomatic way to filter keys in a mapped type.
- Template literal pattern `` `_${string}` `` cleanly matches any string starting with an underscore.
- This is simpler than using `Omit` or `Pick` with a union of filtered keys.
