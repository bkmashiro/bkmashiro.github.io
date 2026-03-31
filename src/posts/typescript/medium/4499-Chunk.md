---
date: 2026-03-31
description: TypeChallenge - 4499 - Medium - Chunk
title: "4499 · Chunk"
readingTime: true
tag:
  - TypeScript
  - TypeChallenge
  - TC-Medium
outline: [2, 3]
article: false
---

# 4499 · Chunk

[Challenge Link](https://tsch.js.org/4499)

## Problem

Do you know `lodash`? `Chunk` is a very useful function in it, now let's implement it.
`Chunk<T, N>` accepts two required type parameters, the `T` must be a tuple, and the `N` must be an integer ≥ 1.

```ts
type exp1 = Chunk<[1, 2, 3], 2>    // [[1, 2], [3]]
type exp2 = Chunk<[1, 2, 3], 4>    // [[1, 2, 3]]
type exp3 = Chunk<[], 0>            // []
```

## Solution

### Approach: Accumulate a Current Chunk

Use a `Current` accumulator tuple that collects elements one at a time. When its length reaches `N`, flush it into the result and start fresh.

```ts
type Chunk<
  T extends unknown[],
  N extends number,
  Current extends unknown[] = []
> = T extends [infer Head, ...infer Tail]
  ? Current['length'] extends N
    ? [Current, ...Chunk<T, N>]
    : Chunk<Tail, N, [...Current, Head]>
  : Current extends []
    ? []
    : [Current]
```

**Step-by-step trace for `Chunk<[1, 2, 3], 2>`:**

```
Chunk<[1,2,3], 2, []>     → Current.length=0 ≠ 2, add Head=1
Chunk<[2,3], 2, [1]>      → Current.length=1 ≠ 2, add Head=2
Chunk<[3], 2, [1,2]>      → Current.length=2 = N! flush [1,2], restart with T=[3]
  ↪ [[1,2], ...Chunk<[3], 2, []>]
Chunk<[3], 2, []>         → add Head=3
Chunk<[], 2, [3]>         → T exhausted, Current=[3] non-empty → [[3]]
Result: [[1,2], [3]]  ✓
```

## Deep Dive

### The Critical "Restart with T" Detail

When flushing, the recursion restarts with the **full `T`** (which still includes `Head`), not `Tail`:

```ts
? [Current, ...Chunk<T, N>]   // ✅ pass T (includes current Head)
//          ↑
//          NOT Tail — if we passed Tail, Head would be lost
```

This is the single most common mistake in Chunk implementations. The flush fires **before** consuming the current element, so we must not advance past it.

### Tuple Length as a Type-Level Counter

TypeScript tuple `['length']` yields a numeric literal type:

```ts
type T = [1, 2, 3]
type Len = T['length']  // 3 (literal, not broad `number`)
```

`Current['length'] extends N` is a zero-cost type-level comparison. This pattern — using tuple length as an integer accumulator — is the backbone of many type-level counting challenges.

### Empty Tuple Detection

```ts
: Current extends []
    ? []
    : [Current]
```

`Current extends []` matches the empty tuple literal specifically. This is preferred over `Current['length'] extends 0` for readability, and both work reliably because TypeScript can narrow to empty tuple types.

### Handling Edge Cases

| Input | Behaviour |
|-------|-----------|
| `Chunk<[], N>` | `T` fails to match `[infer Head, ...]`, `Current = []` → `[]` |
| `Chunk<[1,2,3], 4>` | N > length; entire tuple accumulates into one chunk → `[[1,2,3]]` |
| `Chunk<[1,2,3], 1>` | Each element becomes its own chunk → `[[1],[2],[3]]` |

### Comparison with the JavaScript Runtime

The JavaScript equivalent:

```ts
function chunk<T>(arr: T[], n: number): T[][] {
  const result: T[][] = []
  for (let i = 0; i < arr.length; i += n) {
    result.push(arr.slice(i, i + n))
  }
  return result
}
```

The type-level version mirrors the imperative loop structurally: instead of `i += n` we use `Current['length'] extends N`, and instead of `arr.slice` we use pattern matching to gather elements into `Current`.

### Type Parameter Defaults Hide Complexity

The `Current extends unknown[] = []` default makes the accumulator invisible to callers:

```ts
// External call — clean, no accumulator exposed
type R = Chunk<[1,2,3,4,5], 2>  // [[1,2],[3,4],[5]]
```

Internal recursive calls pass `Current` explicitly to thread state through the recursion.

## Key Takeaways

- **"Flush then restart with T"** — when a chunk fills, restart recursion with the full `T` (not `Tail`) to avoid skipping the current `Head`; this is the key correctness detail
- **Tuple `['length']` as counter** — numeric literal types on tuple lengths enable type-level equality checks without any arithmetic utility types
- **`extends []` for empty tuple** — cleaner and more idiomatic than `['length'] extends 0` for detecting an empty accumulator
- **Three-phase recursion** — the "accumulate → flush → terminate" pattern is reusable for any type-level grouping or batching problem
- **Default type parameters** — using `= []` on `Current` keeps the public API clean while threading mutable state through recursive calls
