---
date: 2024-08-18
description: TypeChallenge - 2759
title: RequiredByKeys
readingTime: true
tag:
  - TypeScript
  - TypeChallenge
  - TC-Medium
outline: [2, 3]
article: false
---

# RequiredByKeys
[Problem Link](https://tsch.js.org/2759)

## Problem

Implement a generic `RequiredByKeys<T, K>` which takes two type arguments `T` and `K`.

`K` specifies the set of properties of `T` that should be required. When `K` is not provided, all properties are required, just like the normal `Required<T>`.

```ts
interface User {
  name?: string
  age?: number
  address?: string
}

type UserRequiredName = RequiredByKeys<User, 'name'>
// { name: string; age?: number; address?: string }
```

## Solution

### Approach 1: Split and Merge (Recommended)

Split the object into two parts — required keys and optional keys — then intersect them:

```ts
// Flatten an intersection into a single object type (removes the & visual noise)
type Merge<T> = { [K in keyof T]: T[K] }

type RequiredByKeys<T, K extends keyof T = keyof T> =
  Merge<
    { [P in K]-?: T[P] }           // required portion (remove optionality)
    & { [P in Exclude<keyof T, K>]?: T[P] }  // optional portion (keep as-is)
  >
```

**How it works:**
1. `{ [P in K]-?: T[P] }` — maps over the selected keys `K`, stripping `?` (the `-?` modifier removes optionality).
2. `{ [P in Exclude<keyof T, K>]?: T[P] }` — keeps the remaining keys optional.
3. `Merge<...>` — flattens the intersection `A & B` into a plain object so TypeScript displays it nicely.

### Approach 2: Using Required and Pick

Compose built-in utility types:

```ts
type Merge<T> = { [K in keyof T]: T[K] }

type RequiredByKeys<T, K extends keyof T = keyof T> =
  Merge<Required<Pick<T, K>> & Omit<T, K>>
```

**How it works:**
1. `Pick<T, K>` — extract only the selected keys.
2. `Required<...>` — make those keys required.
3. `Omit<T, K>` — the rest of the type, unchanged (stays optional if it was).
4. Intersect and merge.

This is more readable because it uses familiar built-ins.

### Approach 3: Conditional Mapped Type

Handle optionality inline with a conditional type:

```ts
type RequiredByKeys<T, K extends keyof T = keyof T> = {
  [P in keyof T as P extends K ? P : never]-?: T[P]
} & {
  [P in keyof T as P extends K ? never : P]?: T[P]
} extends infer O ? { [Q in keyof O]: O[Q] } : never
```

Using `as` clause (key remapping, TS 4.1+) to filter keys inline. The final `extends infer O ? { [Q in keyof O]: O[Q] } : never` is another way to write `Merge<...>`.

## Why `Merge<T>` is Necessary

Without `Merge`, TypeScript shows the type as an intersection:

```ts
// Without Merge: displayed as
// { name: string } & { age?: number; address?: string }

// With Merge: displayed as
// { name: string; age?: number; address?: string }
```

Both are structurally equivalent, but `Merge` produces cleaner hover tooltips.

## Relationship to PartialByKeys (2757)

`RequiredByKeys` is the exact dual of `PartialByKeys`:

```ts
// Make selected keys optional
type PartialByKeys<T, K extends keyof T = keyof T> =
  Merge<{ [P in K]?: T[P] } & Omit<T, K>>

// Make selected keys required
type RequiredByKeys<T, K extends keyof T = keyof T> =
  Merge<{ [P in K]-?: T[P] } & Omit<T, K>>
```

The only difference: `?:` vs `-?:`.

## Key Takeaways

- `-?` modifier removes optionality from mapped types (the counterpart to `?` which adds it).
- Split-and-merge is the cleanest pattern for "modify some keys, leave others alone" problems.
- `Merge<T>` (aka `{ [K in keyof T]: T[K] }`) is an essential utility for flattening intersection types.
- `= keyof T` as a default for `K` makes the type degrade gracefully to `Required<T>` when `K` is omitted.
