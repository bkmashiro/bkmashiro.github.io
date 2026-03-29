---
date: 2026-03-29
description: TypeChallenge - 9989
title: Count Element Number To Object
readingTime: true
tag:
  - TypeScript
  - TypeChallenge
  - TC-Medium
outline: [2, 3]
article: false
---

# Count Element Number To Object
[Problem Link](https://tsch.js.org/9989)

## Problem

With type `CountElementNumberToObject`, get the number of occurrences of every item from an array and return them as an object. For example:

```ts
type Simple1 = CountElementNumberToObject<[]> // {}
type Simple2 = CountElementNumberToObject<[1, 2, 3, 4, 5]>
// {
//   1: 1,
//   2: 1,
//   3: 1,
//   4: 1,
//   5: 1
// }
type Simple3 = CountElementNumberToObject<[1, 2, 3, 4, 5, [1, 2, 3]]>
// {
//   1: 2,
//   2: 2,
//   3: 2,
//   4: 1,
//   5: 1
// }
```

## Solution

### Approach: Flatten First, Then Count

First flatten the array one level, then count occurrences using tuple accumulators in a record.

```ts
type Flatten<T extends unknown[]> = T extends [infer Head, ...infer Tail]
  ? Head extends unknown[]
    ? [...Head, ...Flatten<Tail>]
    : [Head, ...Flatten<Tail>]
  : []

type AddToCount<
  Counts extends Record<PropertyKey, unknown[]>,
  K extends PropertyKey
> = {
  [P in keyof Counts | K]: P extends K
    ? P extends keyof Counts
      ? [...Counts[P], unknown]
      : [unknown]
    : P extends keyof Counts
      ? Counts[P]
      : never
}

type BuildCounts<
  T extends PropertyKey[],
  Counts extends Record<PropertyKey, unknown[]> = {}
> = T extends [infer Head extends PropertyKey, ...infer Tail extends PropertyKey[]]
  ? BuildCounts<Tail, AddToCount<Counts, Head>>
  : Counts

type ToLengths<T extends Record<PropertyKey, unknown[]>> = {
  [K in keyof T]: T[K]['length']
}

type CountElementNumberToObject<T extends unknown[]> =
  ToLengths<BuildCounts<Flatten<T> extends PropertyKey[] ? Flatten<T> : never>>
```

**How it works:**
1. `Flatten` converts `[1, 2, [1, 2]]` → `[1, 2, 1, 2]`.
2. `BuildCounts` walks through each element, maintaining a record where each value is a tuple accumulator.
3. `AddToCount` appends one `unknown` to the correct bucket (or creates it).
4. `ToLengths` converts tuple lengths to numeric types.

## Key Takeaways

- Tuple accumulators as record values elegantly represent counts without type-level arithmetic.
- `ToLengths` as a final transformation separates counting from length extraction.
- `Flatten` as a preprocessing step simplifies the main counting logic.
