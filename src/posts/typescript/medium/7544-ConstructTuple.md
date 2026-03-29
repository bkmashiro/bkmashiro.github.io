---
date: 2026-03-29
description: TypeChallenge - 7544
title: Construct Tuple
readingTime: true
tag:
  - TypeScript
  - TypeChallenge
  - TC-Medium
outline: [2, 3]
article: false
---

# Construct Tuple
[Problem Link](https://tsch.js.org/7544)

## Problem

Construct a tuple with a given length.

```ts
type result = ConstructTuple<2>  // [unknown, unknown]
```

## Solution

### Approach: Accumulator until Target Length

Recursively grow a tuple until its length equals `L`.

```ts
type ConstructTuple<
  L extends number,
  T extends unknown[] = []
> = T['length'] extends L
  ? T
  : ConstructTuple<L, [...T, unknown]>
```

**How it works:**
1. Start with an empty tuple `T = []`.
2. If `T['length'] === L`, return `T`.
3. Otherwise, append one `unknown` and recurse.

## Key Takeaways

- This is the fundamental "build a tuple of length N" pattern that underpins type-level arithmetic throughout TypeScript challenges.
- The accumulator `T` doubles as both the result and the counter.
