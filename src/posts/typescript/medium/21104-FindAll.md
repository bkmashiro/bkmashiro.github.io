---
date: 2024-08-18
description: TypeChallenge - 21104
title: FindAll
readingTime: true
tag:
  - TypeScript
  - TypeChallenge
  - TC-Medium
outline: [2, 3]
article: false
---

# FindAll
[Problem Link](https://tsch.js.org/21104)

## Problem

Given a pattern string `P` and a text string `T`, implement the type `FindAll<T, P>` that returns an array containing all the indices where `P` occurs in `T`.

```ts
type Matched = FindAll<'Collection | Mutation | Query', 'Collection'> // [0]
type Matched2 = FindAll<'TwoTwo', 'Two'>  // [0, 3]
type Empty    = FindAll<'', 'Two'>        // []
type NotFound = FindAll<'Collection | Mutation | Query', 'Foo'> // []
```

## Solution

```ts
type FindAll<
  T extends string,
  P extends string,
  Acc extends number[] = [],
  Idx extends any[] = []
> =
  P extends ''
    ? []
    : T extends `${string}${infer Rest}`
      ? T extends `${P}${string}`
        ? FindAll<Rest, P, [...Acc, Idx['length']], [...Idx, unknown]>
        : FindAll<Rest, P, Acc, [...Idx, unknown]>
      : Acc
```

**How it works:**
1. Use `Idx` as a counter (tuple length = current index).
2. At each position, check if the remaining string `T` starts with `P` using `T extends \`${P}${string}\``.
3. If yes, record `Idx['length']` in `Acc` and advance one character.
4. Otherwise just advance one character.
5. Return `Acc` when the string is exhausted.

## Key Takeaways

- Tracking position with a tuple counter (`Idx['length']`) is the standard way to get numeric indices in TS type recursion.
- Checking `T extends \`${P}${string}\`` tests whether the *current suffix* starts with the pattern.
- Advancing by one character at a time (`T extends \`${string}${infer Rest}\``) allows overlapping matches.
