---
date: 2026-03-29
description: TypeChallenge - 9142
title: Check Repeated Chars
readingTime: true
tag:
  - TypeScript
  - TypeChallenge
  - TC-Medium
outline: [2, 3]
article: false
---

# Check Repeated Chars
[Problem Link](https://tsch.js.org/9142)

## Problem

Implement `CheckRepeatedChars<S>` which will return whether type `S` contains repeated characters.

```ts
type CheckRepeatedChars<'abc'>   // false
type CheckRepeatedChars<'aba'>   // true
```

## Solution

### Approach: Track Seen Characters

Peel characters one by one and check against the set of already-seen characters.

```ts
type CheckRepeatedChars<
  S extends string,
  Seen extends string = never
> = S extends `${infer C}${infer Rest}`
  ? C extends Seen
    ? true
    : CheckRepeatedChars<Rest, Seen | C>
  : false
```

**How it works:**
1. Extract the first character `C`.
2. Check if `C extends Seen` (i.e., `C` is already in the seen set).
3. If yes, return `true` — a repeat was found.
4. Otherwise, add `C` to `Seen` and recurse on `Rest`.
5. If we exhaust the string without finding a repeat, return `false`.

## Key Takeaways

- Accumulating a union of seen characters (`Seen`) is the type-level equivalent of a `Set`.
- `C extends Seen` checks membership in the union — works because `'a' extends 'a' | 'b'` is `true`.
- The `Seen = never` default initializes to an empty set.
