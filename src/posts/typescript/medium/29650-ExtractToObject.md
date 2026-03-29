---
date: 2024-08-18
description: TypeChallenge - 29650
title: ExtractToObject
readingTime: true
tag:
  - TypeScript
  - TypeChallenge
  - TC-Medium
outline: [2, 3]
article: false
---

# ExtractToObject
[Problem Link](https://tsch.js.org/29650)

## Problem

Implement a type that extracts the value of a property from a union of objects and merges it with the rest of the object.

```ts
type T0 = ExtractToObject<{ id: 1; city: 'New York' } | { id: 2; city: 'Paris' }, 'city'>
// { id: 1; city: 'New York' } | { id: 2; city: 'Paris' }   (same here, city is scalar)

// More illustrative:
type T1 = ExtractToObject<
  { id: 1; address: { city: 'New York'; zip: '10001' } } |
  { id: 2; address: { city: 'Paris'; zip: '75001' } },
  'address'
>
// { id: 1; city: 'New York'; zip: '10001' } | { id: 2; city: 'Paris'; zip: '75001' }
```

## Solution

```ts
type ExtractToObject<T, U extends keyof T> =
  T extends T
    ? Omit<T, U> & T[U]
    : never
```

With flattening:

```ts
type Flatten<T> = { [K in keyof T]: T[K] }

type ExtractToObject<T, U extends keyof T> =
  T extends T
    ? Flatten<Omit<T, U> & T[U]>
    : never
```

**How it works:**
1. `T extends T` distributes the operation over each member of the union.
2. For each union member, `Omit<T, U>` removes the key `U` from the object.
3. `T[U]` is the type of the extracted property (an object type in the interesting case).
4. Intersecting with `T[U]` merges its properties into the result.
5. `Flatten` collapses `&` into a clean object type.

## Key Takeaways

- Distribution with `T extends T` applies the transformation per union member, preserving the union structure.
- `Omit<T, U> & T[U]` is the standard "spread/inline nested object" pattern.
- `Flatten<T>` (`{ [K in keyof T]: T[K] }`) resolves intersection types into a single readable object type.
