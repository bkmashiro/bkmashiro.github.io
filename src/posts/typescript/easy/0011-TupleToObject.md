---
date: 2024-08-18
description: TypeChallenge - 0011 - Easy - Tuple to Object
title: "0011 · Tuple to Object"
readingTime: true
tag:
  - TypeScript
  - TypeChallenge
  - TC-Easy
outline: [2, 3]
article: false
---

# 0011 · Tuple to Object

[Challenge Link](https://tsch.js.org/11)

## Problem

Given an array, transform it into an object type and the key/value must be in the provided array.

```ts
const tuple = ['tesla', 'model 3', 'model X', 'model Y'] as const

type result = TupleToObject<typeof tuple>
// expected { 'tesla': 'tesla', 'model 3': 'model 3', 'model X': 'model X', 'model Y': 'model Y' }
```

## Solution

```ts
type TupleToObject<T extends readonly (string | number | symbol)[]> = {
  [K in T[number]]: K
}
```

## Explanation

The key insight here is `T[number]` — indexing a tuple/array with `number` produces a union of all its element types.

**Step by step:**
1. `T extends readonly (string | number | symbol)[]` — constrains `T` to a readonly tuple whose elements can be used as object keys (string, number, or symbol)
2. `T[number]` — produces a union of all element types in `T`. For `['tesla', 'model 3']`, this gives `'tesla' | 'model 3'`
3. `[K in T[number]]` — iterates over each value `K` from the union
4. `: K` — the value type is the same as the key (each key maps to itself)

**Why `readonly`?**
The `as const` assertion (used in the test cases) makes the tuple `readonly`. Without `extends readonly ...[]`, TypeScript would reject `readonly` tuples as input.

**Why `string | number | symbol`?**
These are the only types valid as object keys in TypeScript. Adding this constraint means TypeScript can confirm that each `K` is a valid key for the resulting object type.

**Key concepts:**
- [Indexed Access Types](https://www.typescriptlang.org/docs/handbook/2/indexed-access-types.html) — `T[number]` extracts all element types as a union
- [Mapped Types](https://www.typescriptlang.org/docs/handbook/2/mapped-types.html)
- [`as const`](https://www.typescriptlang.org/docs/handbook/2/narrowing.html#the-in-operator-narrowing) — narrows literal types and makes tuples readonly

::: tip
`T[number]` works because arrays/tuples have numeric indices. Indexing with `number` asks TypeScript: "what type can I get when I index this array with any number?" — and the answer is the union of all element types.
:::
