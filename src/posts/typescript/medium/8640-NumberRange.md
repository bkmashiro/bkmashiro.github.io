---
date: 2026-03-29
description: TypeChallenge - 8640
title: Number Range
readingTime: true
tag:
  - TypeScript
  - TypeChallenge
  - TC-Medium
outline: [2, 3]
article: false
---

# Number Range
[Problem Link](https://tsch.js.org/8640)

## Problem

Sometimes we want to limit the range of numbers. For example:

```ts
type result = NumberRange<2 , 9>
// | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9
```

## Solution

### Approach: Grow a Tuple and Collect Lengths

Build a tuple from length `Low` to `High`, collecting each intermediate length as a union member.

```ts
type NumberRange<
  Low extends number,
  High extends number,
  Count extends unknown[] = [],
  Collecting extends boolean = false,
  Result extends number = never
> = Count['length'] extends High
  ? Result | High
  : Collecting extends true
    ? NumberRange<Low, High, [...Count, unknown], true, Result | Count['length']>
    : Count['length'] extends Low
      ? NumberRange<Low, High, [...Count, unknown], true, Result | Low>
      : NumberRange<Low, High, [...Count, unknown], false, Result>
```

**How it works:**
1. Increment `Count` from 0 upward.
2. Once `Count['length']` hits `Low`, set `Collecting = true` and start adding lengths to `Result`.
3. When `Count['length']` hits `High`, add `High` to `Result` and return.

## Key Takeaways

- A `Collecting` boolean flag avoids checking `GreaterThan` at every step.
- This pattern — "start collecting at X, stop at Y" — is reusable for any range generation.
- The final `| High` at the base case ensures the upper bound is inclusive.
