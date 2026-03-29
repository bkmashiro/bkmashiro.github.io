---
date: 2026-03-29
description: TypeChallenge - 9896
title: Get Middle Element
readingTime: true
tag:
  - TypeScript
  - TypeChallenge
  - TC-Medium
outline: [2, 3]
article: false
---

# Get Middle Element
[Problem Link](https://tsch.js.org/9896)

## Problem

Get the middle element of the array by implementing a `GetMiddleElement` method, the result should be returned in an array format.

```ts
GetMiddleElement<[1, 2, 3, 4, 5]> // [3]
GetMiddleElement<[1, 2, 3, 4, 5, 6]> // [3, 4]  (two middle elements for even length)
```

## Solution

### Approach: Peel Both Ends Simultaneously

Remove one element from the front and one from the back each step. When 1 or 2 elements remain, that's the middle.

```ts
type GetMiddleElement<T extends unknown[]> =
  T extends [infer _First, ...infer Middle, infer _Last]
    ? Middle extends []
      ? T  // 2 elements left — both are middle
      : GetMiddleElement<Middle>
    : T   // 0 or 1 element — that's the middle
```

**How it works:**
1. Pattern match `[First, ...Middle, Last]` to peel first and last.
2. If `Middle` is empty, both `First` and `Last` remain — return `T` (the 2-element tuple).
3. Otherwise, recurse on `Middle`.
4. If `T` has 0 or 1 elements (can't destructure both ends), return `T` as-is.

## Key Takeaways

- TypeScript's rest-in-the-middle pattern `[infer F, ...infer M, infer L]` is a powerful way to peel both ends at once.
- The invariant "middle is empty means exactly 2 elements left" works because we only reach this branch with ≥ 2 elements.
