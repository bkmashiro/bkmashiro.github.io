---
date: 2024-08-18
description: TypeChallenge - 0018 - Easy - Length of Tuple
title: "0018 · Length of Tuple"
readingTime: true
tag:
  - TypeScript
  - TypeChallenge
  - TC-Easy
outline: [2, 3]
article: false
---

# 0018 · Length of Tuple

[Challenge Link](https://tsch.js.org/18)

## Problem

For given a tuple, create a generic `Length` that picks the length of the tuple.

```ts
type tesla = ['tesla', 'model 3', 'model X', 'model Y']
type spaceX = ['FALCON 9', 'FALCON HEAVY', 'DRAGON', 'STARSHIP', 'HUMAN SPACEFLIGHT', 'RAPTOR']

type teslaLength = Length<tesla> // expected 4
type spaceXLength = Length<spaceX> // expected 6
```

## Solution

```ts
type Length<T extends readonly any[]> = T["length"]
```

## Explanation

In TypeScript, tuples and arrays have a `length` property accessible via indexed access types.

### Why `T["length"]` Works

For a fixed-length tuple like `['a', 'b', 'c']`, TypeScript tracks the exact length as a literal numeric type:

```ts
type T = ['a', 'b', 'c']
type L = T["length"]  // 3 (literal type, not just number)
```

This is different from regular arrays where `T["length"]` would be `number` (could be any number). For tuples, TypeScript knows the exact length at compile time.

### Why `readonly any[]`?

The constraint `T extends readonly any[]` accepts both:
- Regular mutable arrays: `string[]`, `any[]`
- Readonly tuples and arrays: `readonly string[]`, `readonly [1, 2, 3]`

Without `readonly`, you couldn't pass a `const` tuple (which TypeScript infers as `readonly`):

```ts
const t = ['a', 'b', 'c'] as const
// typeof t = readonly ["a", "b", "c"]
type L = Length<typeof t>  // works because of readonly constraint
```

### Array vs Tuple

| Type | `length` type |
|------|--------------|
| `string[]` | `number` |
| `['a', 'b', 'c']` | `3` |
| `readonly ['x', 'y']` | `2` |

**Step by step:**
1. `T extends readonly any[]` — constrains `T` to be a tuple or array
2. `T["length"]` — indexed access type that retrieves the `length` property type
3. For tuples, this returns the exact literal number; for arrays, it returns `number`

**Key concepts:**
- [Indexed Access Types](https://www.typescriptlang.org/docs/handbook/2/indexed-access-types.html) — `T["key"]` to look up a property type
- `readonly` modifier — enables the type to work with `as const` tuples
