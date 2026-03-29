---
date: 2026-03-29
description: TypeChallenge - 9286
title: First Unique Char Index
readingTime: true
tag:
  - TypeScript
  - TypeChallenge
  - TC-Medium
outline: [2, 3]
article: false
---

# First Unique Char Index
[Problem Link](https://tsch.js.org/9286)

## Problem

Given a string `S`, find the first non-repeating character in it and return its index. If it does not exist, return `-1`.

```ts
type A = FirstUniqueCharIndex<'leetcode'> // 0
type B = FirstUniqueCharIndex<'loveleetcode'> // 2
type C = FirstUniqueCharIndex<'aabb'> // -1
```

## Solution

### Approach: Check if Current Char Appears in Remaining String

For each position, check whether the character appears anywhere else in the string.

```ts
type StringIncludes<S extends string, C extends string> =
  S extends `${string}${C}${string}` ? true : false

type FirstUniqueCharIndex<
  S extends string,
  Original extends string = S,
  Count extends unknown[] = []
> = S extends `${infer C}${infer Rest}`
  ? StringIncludes<Rest, C> extends true
    ? FirstUniqueCharIndex<Rest, Original, [...Count, unknown]>
    : StringIncludes<Original extends `${infer Before}${C}${string}` ? Before : never, C> extends true
      ? FirstUniqueCharIndex<Rest, Original, [...Count, unknown]>
      : Count['length']
  : -1
```

A simpler approach using `Split`:

```ts
type FirstUniqueCharIndex<
  S extends string,
  Prefix extends string = '',
  Count extends unknown[] = []
> = S extends `${infer C}${infer Rest}`
  ? `${Prefix}${Rest}` extends `${string}${C}${string}`
    ? FirstUniqueCharIndex<Rest, `${Prefix}${C}`, [...Count, unknown]>
    : Count['length']
  : -1
```

**How it works:**
1. Track `Prefix` — all characters before the current position.
2. For character `C` at the current position, check if `C` appears in `Prefix + Rest`.
3. If not found elsewhere, `Count['length']` is the answer.
4. Otherwise, move `C` into `Prefix` and continue.

## Key Takeaways

- Maintaining a `Prefix` accumulator lets us check both "before" and "after" with a single `includes` check.
- `${string}${C}${string}` is the template literal pattern for "contains C".
- Index tracking via tuple length is the standard approach for positional problems.
