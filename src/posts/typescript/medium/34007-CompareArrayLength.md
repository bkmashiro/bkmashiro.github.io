---
date: 2026-03-29
description: TypeChallenge - 34007 - Medium - CompareArrayLength
title: "34007 · CompareArrayLength"
readingTime: true
tag:
  - TypeScript
  - TypeChallenge
  - TC-Medium
outline: [2, 3]
article: false
---

# 34007 · CompareArrayLength

[Challenge Link](https://tsch.js.org/34007)

## Problem

Implement `CompareArrayLength<T, U>` that compares the lengths of two arrays and returns:
- `1` if `T` is longer than `U`
- `-1` if `T` is shorter than `U`
- `0` if they are the same length

```ts
type cases = [
  Expect<Equal<CompareArrayLength<[1, 2, 3, 4], [5, 6]>, 1>>,
  Expect<Equal<CompareArrayLength<[1, 2], [3, 4, 5, 6]>, -1>>,
  Expect<Equal<CompareArrayLength<[], []>, 0>>,
  Expect<Equal<CompareArrayLength<[1, 2, 3], [4, 5, 6]>, 0>>,
]
```

## Solution

```typescript
type CompareArrayLength<T extends any[], U extends any[]> =
  T['length'] extends U['length']
    ? 0
    : T extends [any, ...infer TR]
      ? U extends [any, ...infer UR]
        ? CompareArrayLength<TR, UR>
        : 1
      : -1
```

## Explanation

The solution uses **recursive tail-peeling** to compare arrays element by element until one runs out.

**Step by step:**

1. `T['length'] extends U['length']` — if both lengths are already equal (TypeScript can check literal number equality here), return `0` immediately. This handles same-length arrays like `[1,2,3]` vs `[4,5,6]`.

2. If lengths differ, we recurse by peeling one element off each:
   - `T extends [any, ...infer TR]` — try to peel the head of `T`; if it fails, `T` is empty
   - `U extends [any, ...infer UR]` — try to peel the head of `U`; if it fails, `U` is empty

3. If both can be peeled, recurse with `CompareArrayLength<TR, UR>` — effectively counting down simultaneously.

4. If `T` can be peeled but `U` cannot — `T` still has elements while `U` is exhausted → `T` is longer → return `1`.

5. If `T` cannot be peeled (but the length check failed, meaning `U` is longer) → return `-1`.

**Why check `T['length'] extends U['length']` first?**

Without this check, the recursion would always peel until one is empty. The early exit makes the logic cleaner and avoids unnecessary recursion for same-length tuples.

## Key Concepts

- **Tuple length indexing** — `T['length']` gives the literal number type for tuple lengths
- **Variadic tuple spreading** — `[any, ...infer Rest]` deconstructs a tuple, extracting head and tail
- **Recursive conditional types** — using self-referential type aliases to simulate loops
