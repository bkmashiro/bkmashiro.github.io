---
date: 2026-03-29
description: TypeChallenge - 9898
title: Appear Only Once
readingTime: true
tag:
  - TypeScript
  - TypeChallenge
  - TC-Medium
outline: [2, 3]
article: false
---

# Appear Only Once
[Problem Link](https://tsch.js.org/9898)

## Problem

Find the elements in the target array that appear only once. For example: input: `[1,2,2,3,3,4,5,6,6,6]`, output: `[1,4,5]`.

## Solution

### Approach: Check Both Prefix and Suffix

For each element, verify it doesn't appear in the rest of the array, and also not before it.

```ts
type IsEqual<A, B> =
  (<T>() => T extends A ? 1 : 2) extends
  (<T>() => T extends B ? 1 : 2)
    ? true : false

type Includes<T extends unknown[], U> =
  T extends [infer Head, ...infer Tail]
    ? IsEqual<Head, U> extends true
      ? true
      : Includes<Tail, U>
    : false

type AppearOnlyOnce<
  T extends unknown[],
  Seen extends unknown[] = []
> = T extends [infer Head, ...infer Tail]
  ? Includes<Seen, Head> extends true
    ? AppearOnlyOnce<Tail, Seen>  // skip — already seen
    : Includes<Tail, Head> extends true
      ? AppearOnlyOnce<Tail, [...Seen, Head]>  // appears later — skip but mark seen
      : [Head, ...AppearOnlyOnce<Tail, [...Seen, Head]>]  // unique — include
  : []
```

**How it works:**
1. `Seen` tracks elements already encountered.
2. If `Head` is in `Seen`, skip it (it was a duplicate we already dropped).
3. If `Head` appears in `Tail`, mark it as seen and skip it.
4. Otherwise, `Head` appears exactly once — include it in the result.

## Key Takeaways

- A `Seen` accumulator prevents re-processing the same value twice in the result.
- The two-phase check (in Seen? in Tail?) correctly handles elements appearing 3+ times.
- `IsEqual` ensures strict equality, avoiding issues with `any`/`never`.
