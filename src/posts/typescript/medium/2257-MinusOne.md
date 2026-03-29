---
date: 2024-08-18
description: TypeChallenge - 2257
title: Minus One
readingTime: true
tag:
  - TypeScript
  - TypeChallenge
  - TC-Medium
outline: [2, 3]
article: false
---

# Minus One
[Problem Link](https://tsch.js.org/2257)

## Problem

Given a number (always positive) as a type, your type should return the number decreased by one.

```ts
type Zero = MinusOne<1>     // 0
type FiftyFour = MinusOne<55> // 54
```

## Solution

### Approach 1: Build an Array and Take its Length

The classic TypeScript trick for arithmetic: build a tuple of length `N`, then measure `['length']` after manipulating it.

To subtract 1, we build a tuple of length `N` and then take the length of its tail (drop the first element).

```ts
// Helper: build a tuple of length N filled with unknown
type BuildTuple<N extends number, T extends unknown[] = []> =
  T['length'] extends N ? T : BuildTuple<N, [...T, unknown]>

// Drop the first element and read length
type MinusOne<T extends number> =
  BuildTuple<T> extends [infer _, ...infer Rest]
    ? Rest['length']
    : never
```

**How it works:**
1. `BuildTuple<5>` → `[unknown, unknown, unknown, unknown, unknown]`
2. Destructuring `[infer _, ...infer Rest]` gives a 4-element Rest.
3. `Rest['length']` → `4`

**Limitation:** TypeScript's recursive type depth limit means this breaks for large numbers (> ~1000).

### Approach 2: String-Based Digit Subtraction (handles larger numbers)

For larger numbers, convert to a string and implement digit-by-digit subtraction.

```ts
type DigitMinusOne = {
  '0': '9'
  '1': '0'
  '2': '1'
  '3': '2'
  '4': '3'
  '5': '4'
  '6': '5'
  '7': '6'
  '8': '7'
  '9': '8'
}

// Subtract 1 from a numeric string, handling borrow propagation
type SubtractOneStr<S extends string> =
  S extends `${infer Head}${infer Last}`
    ? Last extends '0'
      ? Head extends ''
        ? never  // would go negative
        : `${SubtractOneStr<Head>}9`
      : `${Head}${DigitMinusOne[Last & keyof DigitMinusOne]}`
    : never

// Remove leading zeros (e.g., "09" -> "9"), but keep single "0"
type TrimLeadingZeros<S extends string> =
  S extends `0${infer Rest}`
    ? Rest extends ''
      ? '0'
      : TrimLeadingZeros<Rest>
    : S

type MinusOne<T extends number> =
  `${T}` extends '0'
    ? never  // 0 - 1 is out of scope (problem says always positive)
    : TrimLeadingZeros<SubtractOneStr<`${T}`>> extends `${infer N extends number}`
      ? N
      : never
```

**How it works:**
1. Convert `T` to its string representation with template literal.
2. Subtract 1 from the last digit; if it was `'0'`, borrow from the left (recursively).
3. Strip leading zeros (e.g., `100 - 1 = 099 → 99`).
4. Parse the result string back to a `number` type using `infer N extends number`.

This approach handles numbers up to TypeScript's template literal limits (well past 1000).

## Key Takeaways

| Technique | When to use |
|-----------|-------------|
| Tuple length | Small numbers (≤ ~999), simple/readable |
| String digit math | Large numbers, production-ready solutions |

- `infer N extends number` (TS 4.8+) is the cleanest way to parse a numeric string back to a number type.
- Recursive conditional types + tuple spreading are the foundation of type-level arithmetic in TypeScript.
