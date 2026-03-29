---
date: 2024-08-18
description: TypeChallenge - 27932
title: MergeAll
readingTime: true
tag:
  - TypeScript
  - TypeChallenge
  - TC-Medium
outline: [2, 3]
article: false
---

# MergeAll
[Problem Link](https://tsch.js.org/27932)

## Problem

Merge all objects in a tuple into a single type. Shared keys take the union of their value types.

```ts
type X = MergeAll<[{ a: 1 }, { b: 2 }]>          // { a: 1; b: 2 }
type Y = MergeAll<[{ a: 1 }, { a: 2 }]>          // { a: 1 | 2 }
type Z = MergeAll<[{ a: 1; b: string }, { b: number }]> // { a: 1; b: string | number }
```

## Solution

```ts
type MergeAll<T extends object[], Acc extends object = {}> =
  T extends [infer First extends object, ...infer Rest extends object[]]
    ? MergeAll<Rest, {
        [K in keyof Acc | keyof First]:
          K extends keyof Acc
            ? K extends keyof First
              ? Acc[K] | First[K]   // key in both: union
              : Acc[K]              // key only in Acc
            : K extends keyof First
              ? First[K]            // key only in First
              : never
      }>
    : Acc
```

**How it works:**
1. Recursively process the tuple, accumulating the merged object in `Acc`.
2. For each object `First`, create a new object whose keys are the union of `keyof Acc` and `keyof First`.
3. For each key, produce the union of values if the key appears in both, otherwise take the value from whichever has it.
4. When the tuple is exhausted, return `Acc`.

## Key Takeaways

- `keyof Acc | keyof First` as the mapped type key produces all keys from both objects.
- Three-way key discrimination (`in Acc only`, `in First only`, `in both`) is required for correct value typing.
- Accumulating into `Acc` instead of a single-pass union avoids needing extra intersection cleanup.
