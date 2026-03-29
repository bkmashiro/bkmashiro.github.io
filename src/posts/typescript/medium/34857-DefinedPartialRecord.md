---
date: 2026-03-29
description: TypeChallenge - 34857 - Medium - DefinedPartialRecord
title: "34857 · DefinedPartialRecord"
readingTime: true
tag:
  - TypeScript
  - TypeChallenge
  - TC-Medium
outline: [2, 3]
article: false
---

# 34857 · DefinedPartialRecord

[Challenge Link](https://tsch.js.org/34857)

## Problem

Implement `DefinedPartial<T>` that, given an object type `T`, produces a union of all possible non-empty subsets of `T`'s properties — each subset having all its keys required (not optional).

```ts
type A = Record<'a' | 'b', string>
type E = { a: string } | { b: string } | { a: string, b: string }
// DefinedPartial<A> should equal E
```

## Solution

```typescript
// Convert union to tuple
type UnionToIntersection<U> = (U extends any ? (x: U) => void : never) extends (x: infer I) => void ? I : never
type LastOf<T> = UnionToIntersection<T extends any ? () => T : never> extends () => infer R ? R : never
type UnionToTuple<T, L = LastOf<T>> =
  [T] extends [never] ? [] : [...UnionToTuple<Exclude<T, L>>, L]

// Power set of a tuple of keys (excluding empty set)
type PowerSetOfTuple<T extends any[]> =
  T extends [infer Head, ...infer Tail]
    ? PowerSetOfTuple<Tail> extends infer Sub
      ? Sub | (Sub extends any[] ? [Head, ...Sub] : never) | [Head]
      : never
    : []

// Pick a subset of keys (as tuple) from an object T, combining via intersection
type PickByTuple<T, Keys extends any[]> =
  Keys extends [infer K extends keyof T, ...infer Rest]
    ? { [P in K]: T[P] } & PickByTuple<T, Rest>
    : {}

type Flatten<T> = { [K in keyof T]: T[K] }

// All non-empty subsets of T, each as a required object type
type DefinedPartial<T> =
  PowerSetOfTuple<UnionToTuple<keyof T>> extends infer PS
    ? PS extends any[]
      ? PS extends []
        ? never
        : Flatten<PickByTuple<T, PS>>
      : never
    : never
```

## Explanation

This problem requires generating all **non-empty subsets** of an object's keys, where each subset becomes a required object type. The result is a union of all such subsets.

**High-level strategy:** convert keys to a tuple → compute power set → for each subset tuple, pick those keys from `T` → union all results.

### Step 1: Union to Tuple (`UnionToTuple`)

TypeScript union types are unordered and we can't iterate over them directly. We use the classic trick:
- `UnionToIntersection<U>` converts `A | B | C` to `A & B & C` using distributive conditional types and function parameter contravariance.
- `LastOf<T>` extracts the last member of a union by using `UnionToIntersection` on a function type — the overload intersection resolves to the last overload.
- `UnionToTuple<T>` recursively extracts the last element, builds the tail, and prepends it.

### Step 2: Power Set (`PowerSetOfTuple`)

Given `[A, B, C]`, the power set is all subsets: `[A]`, `[B]`, `[C]`, `[A,B]`, `[A,C]`, `[B,C]`, `[A,B,C]`. We exclude the empty set `[]`.

The recursion works as:
- For each `[Head, ...Tail]`, compute `Sub = PowerSet(Tail)`
- Result = `Sub` (subsets not including Head) | `[Head, ...Sub]` (prepend Head to each existing subset) | `[Head]` (Head alone)

### Step 3: Pick by Tuple (`PickByTuple`)

For a key tuple like `['a', 'b']`, we create `{a: T['a']} & {b: T['b']}`. The `Flatten` helper maps this intersection to a plain object `{a: T['a'], b: T['b']}`.

### Step 4: Distribute (`DefinedPartial`)

`PowerSetOfTuple<...> extends infer PS ? PS extends any[] ? ... : never : never` distributes over the union of subset tuples — each `PS` gets substituted with one subset at a time, and the results union together.

## Key Concepts

- **Union to tuple conversion** — using `UnionToIntersection` and function overload resolution
- **Power set via recursion** — tuple-based subset generation
- **Distributive conditional types** — `PS extends any[]` distributes over a union of tuples
- **Intersection flattening** — `Flatten<T>` turns `{a:X} & {b:Y}` into `{a:X, b:Y}`
