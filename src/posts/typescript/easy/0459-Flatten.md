---
date: 2026-03-29
description: TypeChallenge - 0459 - Easy - Flatten
title: "0459 · Flatten"
readingTime: true
tag:
  - TypeScript
  - TypeChallenge
  - TC-Easy
outline: [2, 3]
article: false
---

# 0459 · Flatten

[Challenge Link](https://tsch.js.org/459)

## Problem

Implement a type `Flatten<T>` that takes a nested array or tuple type and produces a flattened version.

```ts
type A = Flatten<[1, 2, [3, 4], [[[5]]]]>
// [1, 2, 3, 4, 5]
```

This challenge is about recursively walking through a tuple, checking each element, and expanding nested arrays into the final result.

## Solution

```ts
type Flatten<T extends readonly unknown[]> = T extends readonly [
  infer First,
  ...infer Rest,
]
  ? First extends readonly unknown[]
    ? [...Flatten<First>, ...Flatten<Rest>]
    : [First, ...Flatten<Rest>]
  : []
```

## Explanation

The core idea is:

- split the tuple into a head and tail
- inspect the head
- if the head is itself an array, flatten it recursively
- otherwise keep it and continue with the tail

### Step by Step

1. `T extends readonly unknown[]` constrains the input to arrays and tuples, including readonly tuples.
2. `T extends readonly [infer First, ...infer Rest]` destructures the tuple into its first element and the remaining elements.
3. If `First extends readonly unknown[]`, then `First` is another nested array, so flatten it and spread the result.
4. Otherwise, keep `First` as a single element.
5. Recurse on `Rest`.
6. When `T` is empty, return `[]`.

### Why Use `readonly unknown[]`?

Many type-challenge test cases use readonly tuples inferred from `as const`.

```ts
const data = [1, [2, 3]] as const
```

The type of `data` is readonly, so `Flatten<T extends readonly unknown[]>` is more flexible than `Flatten<T extends unknown[]>`.

The `readonly` marker also needs to appear in the tuple pattern. Otherwise a readonly tuple may fail to match the recursive branch.

### Example Walkthrough

Start with:

```ts
type Result = Flatten<[1, [2, [3]], 4]>
```

The recursion unfolds like this:

```ts
Flatten<[1, [2, [3]], 4]>
-> [1, ...Flatten<[[2, [3]], 4]>]
-> [1, ...Flatten<[2, [3]]>, ...Flatten<[4]>]
-> [1, 2, ...Flatten<[[3]]>, 4]
-> [1, 2, ...Flatten<[3]>, 4]
-> [1, 2, 3, 4]
```

Each nested array is flattened before being merged back into the surrounding result.

## Alternative Solutions

### Option 1: Accumulator Style

```ts
type Flatten2<
  T extends readonly unknown[],
  Acc extends readonly unknown[] = [],
> = T extends readonly [infer First, ...infer Rest]
  ? First extends readonly unknown[]
    ? Flatten2<Rest, [...Acc, ...Flatten2<First>]>
    : Flatten2<Rest, [...Acc, First]>
  : Acc
```

This version collects the result in `Acc`. It can be useful if you prefer an explicit "build the answer as you go" style.

### Option 2: Mutable Array Constraint

```ts
type Flatten3<T extends unknown[]> = T extends [infer First, ...infer Rest]
  ? First extends unknown[]
    ? [...Flatten3<First>, ...Flatten3<Rest>]
    : [First, ...Flatten3<Rest>]
  : []
```

This is shorter, but it is less compatible because it does not accept readonly tuples.

## Thought Process

A flatten operation is naturally recursive:

- a flat value contributes one element
- a nested array contributes all of its flattened elements

That maps directly onto tuple recursion with `[infer First, ...infer Rest]`.

The important insight is that we are solving two problems at the same time:

1. walking across the top-level tuple
2. diving into nested tuples when an element is itself an array

The spread syntax in the result lets both parts compose nicely.

## Key Takeaways

- Tuple recursion is a powerful way to process arrays at the type level.
- `infer First` and `infer Rest` let us model head-tail recursion.
- Spread syntax like `[...A, ...B]` is what makes flattening ergonomic in TypeScript.

**Key concepts:**
- [Variadic Tuple Types](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-4-0.html#variadic-tuple-types)
- [Conditional Types](https://www.typescriptlang.org/docs/handbook/2/conditional-types.html)
- Recursive tuple processing
