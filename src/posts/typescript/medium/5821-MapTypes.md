---
date: 2026-03-29
description: TypeChallenge - 5821
title: MapTypes
readingTime: true
tag:
  - TypeScript
  - TypeChallenge
  - TC-Medium
outline: [2, 3]
article: false
---

# MapTypes
[Problem Link](https://tsch.js.org/5821)

## Problem

Implement `MapTypes<T, R>` which will transform types in object `T` to different types defined by type `R` which has the following structure:

```ts
type StringToNumber = {
  mapFrom: string  // value of type string
  mapTo: number    // will be transformed to type number
}
```

```ts
type SetMixed = MapTypes<{isFun: boolean, year: string}, {mapFrom: boolean; mapTo: string} | {mapFrom: string; mapTo: boolean}>
// {isFun: string, year: boolean}
```

## Solution

### Approach: Mapped Type with Union Lookup

For each property, find the matching `mapFrom` in `R` and use the corresponding `mapTo`.

```ts
type MapTypes<T, R extends { mapFrom: unknown; mapTo: unknown }> = {
  [K in keyof T]: T[K] extends R['mapFrom']
    ? R extends { mapFrom: T[K]; mapTo: infer To }
      ? To
      : never
    : T[K]
}
```

**How it works:**
1. For each key `K`, check if `T[K]` is a valid `mapFrom` value.
2. If so, filter `R` to the specific variant where `mapFrom` matches `T[K]`, and extract `mapTo`.
3. If no match, keep the original type `T[K]`.
4. When `R` is a union, `R extends { mapFrom: T[K] }` distributes and collects all matching `mapTo` types.

## Key Takeaways

- Filtering a union with `R extends { mapFrom: T[K] }` distributes over the union and keeps only matching variants.
- This is the type-level equivalent of `find` on an array of mapping rules.
- When multiple rules match, the result is the union of all `mapTo` types.
