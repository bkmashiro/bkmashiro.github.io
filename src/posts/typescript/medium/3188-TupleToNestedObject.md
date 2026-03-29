---
date: 2024-08-18
description: TypeChallenge - 3188
title: Tuple to Nested Object
readingTime: true
tag:
  - TypeScript
  - TypeChallenge
  - TC-Medium
outline: [2, 3]
article: false
---

# Tuple to Nested Object
[Problem Link](https://tsch.js.org/3188)

## Problem

Given a tuple type `T` and a value type `U`, build a deeply-nested object type where each level corresponds to one element of the tuple, and the innermost value is `U`.

```ts
type a = TupleToNestedObject<['a'], string>
// { a: string }

type b = TupleToNestedObject<['a', 'b'], number>
// { a: { b: number } }

type c = TupleToNestedObject<[], boolean>
// boolean
```

The tuple elements must all extend `string` (they become property keys).

## Solution

### Approach 1: Recursive Head/Tail Destructuring

The classic approach: peel off the first element of the tuple as the key, then recurse on the rest.

```ts
type TupleToNestedObject<T extends string[], U> =
  T extends [infer First extends string, ...infer Rest extends string[]]
    ? { [K in First]: TupleToNestedObject<Rest, U> }
    : U
```

**How it works:**
1. If `T` is non-empty, destructure it into `First` (head) and `Rest` (tail).
2. Create an object type with `First` as the only key, and recursively call `TupleToNestedObject<Rest, U>` as its value.
3. If `T` is empty (`[]`), return `U` directly — this is the base case.

**Step-by-step for `TupleToNestedObject<['a', 'b', 'c'], string>`:**
```
Step 1: First = 'a', Rest = ['b', 'c']  → { a: TupleToNestedObject<['b', 'c'], string> }
Step 2: First = 'b', Rest = ['c']        → { a: { b: TupleToNestedObject<['c'], string> } }
Step 3: First = 'c', Rest = []           → { a: { b: { c: TupleToNestedObject<[], string> } } }
Step 4: T = [] (base case)               → { a: { b: { c: string } } }
```

### Approach 2: Using `infer` with Explicit Key Constraint

An alternative that makes the string constraint more explicit in the `infer` step:

```ts
type TupleToNestedObject<T extends string[], U> =
  T extends []
    ? U
    : T extends [infer K extends string, ...infer Rest extends string[]]
      ? { [P in K]: TupleToNestedObject<Rest, U> }
      : never
```

This checks the empty case first (cleaner control flow) and uses `infer K extends string` (TypeScript 4.8+) to constrain the inferred type inline.

### Approach 3: Manual Property Key via `Record`

You can also use `Record` to express the single-key object:

```ts
type TupleToNestedObject<T extends string[], U> =
  T extends [infer First extends string, ...infer Rest extends string[]]
    ? Record<First, TupleToNestedObject<Rest, U>>
    : U
```

`Record<K, V>` is equivalent to `{ [P in K]: V }` when `K` is a string literal — purely a stylistic choice.

## Edge Cases

```ts
// Empty tuple → returns U directly
type R1 = TupleToNestedObject<[], number>
// number

// Single element
type R2 = TupleToNestedObject<['key'], boolean>
// { key: boolean }

// Deep nesting
type R3 = TupleToNestedObject<['a', 'b', 'c', 'd'], null>
// { a: { b: { c: { d: null } } } }
```

## Key Takeaways

- Tuple head/tail destructuring with `[infer First, ...infer Rest]` is the foundation of recursive tuple processing in TypeScript.
- The base case (`T extends []`) returns the value type `U`, effectively "terminating" the nesting.
- `infer K extends string` (TypeScript 4.8+) cleanly combines inference and constraint.
- This pattern generalizes: any "fold" over a tuple can be expressed as a recursive conditional type.
