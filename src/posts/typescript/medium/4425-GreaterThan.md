---
date: 2026-03-29
description: TypeChallenge - 4425
title: Greater Than
readingTime: true
tag:
  - TypeScript
  - TypeChallenge
  - TC-Medium
outline: [2, 3]
article: false
---

# Greater Than
[Problem Link](https://tsch.js.org/4425)

## Problem

In this challenge, you should implement a type `GreaterThan<T, U>` like `T > U`.

Negative number is not considered.

```ts
GreaterThan<2, 1>   // true
GreaterThan<1, 1>   // false
GreaterThan<10, 100> // false
GreaterThan<111, 11> // true
```

## Solution

### Approach: Race to Fill a Tuple

Build a tuple concurrently for both numbers. The one whose count reaches the target first is smaller — meaning the other is greater.

```ts
type GreaterThan<
  T extends number,
  U extends number,
  Count extends unknown[] = []
> = T extends U
  ? false
  : Count['length'] extends T
    ? false
    : Count['length'] extends U
      ? true
      : GreaterThan<T, U, [...Count, unknown]>
```

**How it works:**
1. If `T === U`, return `false` immediately.
2. We increment `Count` one step at a time.
3. If `Count['length']` reaches `T` first, then `T ≤ Count` before `U`, so `T < U` → `false`.
4. If `Count['length']` reaches `U` first, then `U < T` → `true`.

## Key Takeaways

- "Race" logic (which number do we hit first?) is a clean pattern for type-level comparison.
- This approach has O(max(T, U)) recursion depth — works fine for typical challenge inputs.
- For very large numbers a string-based digit comparison would be needed.
