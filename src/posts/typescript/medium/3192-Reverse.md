---
date: 2024-08-18
description: TypeChallenge - 3192
title: Reverse
readingTime: true
tag:
  - TypeScript
  - TypeChallenge
  - TC-Medium
outline: [2, 3]
article: false
---

# Reverse
[Problem Link](https://tsch.js.org/3192)

## Problem

Implement the type version of `Array.reverse`.

```ts
type a = Reverse<['a', 'b']>       // ['b', 'a']
type b = Reverse<['a', 'b', 'c']>  // ['c', 'b', 'a']
```

## Solution

### Approach 1: Recursive Head/Tail — Prepend Last to Front

The cleanest approach: peel off the **last** element of the tuple and move it to the **front**.

```ts
type Reverse<T extends unknown[]> =
  T extends [...infer Rest, infer Last]
    ? [Last, ...Reverse<Rest>]
    : T
```

**How it works:**
- Destructure `T` into everything except the last element (`Rest`) and the last element itself (`Last`).
- Prepend `Last` to the recursively-reversed `Rest`.
- Base case: when `T` is `[]` or `[X]`, it matches `T` (single element or empty, already reversed).

**Step-by-step for `Reverse<['a', 'b', 'c']>`:**
```
Step 1: Rest = ['a', 'b'], Last = 'c'  → ['c', ...Reverse<['a', 'b']>]
Step 2: Rest = ['a'],      Last = 'b'  → ['c', 'b', ...Reverse<['a']>]
Step 3: Rest = [],         Last = 'a'  → ['c', 'b', 'a', ...Reverse<[]>]
Step 4: T = [] (base case)             → ['c', 'b', 'a']
```

### Approach 2: Accumulator Pattern (Tail-Recursive Style)

Using an accumulator avoids deep recursion by building the result incrementally:

```ts
type Reverse<T extends unknown[], Acc extends unknown[] = []> =
  T extends [infer Head, ...infer Rest]
    ? Reverse<Rest, [Head, ...Acc]>
    : Acc
```

**How it works:**
- Peel the **first** element (`Head`) off `T` and prepend it to the accumulator `Acc`.
- Since we prepend to `Acc`, the first element processed ends up deepest (i.e., last in the result).
- When `T` is empty, `Acc` holds the reversed tuple.

**Step-by-step for `Reverse<['a', 'b', 'c']>`:**
```
Call 1: T = ['a','b','c'], Acc = []         → Reverse<['b','c'], ['a']>
Call 2: T = ['b','c'],     Acc = ['a']      → Reverse<['c'], ['b','a']>
Call 3: T = ['c'],         Acc = ['b','a']  → Reverse<[], ['c','b','a']>
Call 4: T = [],            Acc = ['c','b','a'] → ['c','b','a']
```

This mirrors the classic functional "fold-left" pattern.

### Approach 3: Spread Trick (Non-Recursive, TypeScript 4.0+)

TypeScript 4.0 added variadic tuple types. You can express reversal in terms of spread patterns, though TypeScript does NOT natively support reversing spreads in one step — you still need recursion. However, for **known-length small tuples**, you could hardcode overloads:

```ts
// Works only for fixed arities — impractical for the general case
type Reverse2<T extends unknown[]> =
  T extends [infer A, infer B]         ? [B, A] :
  T extends [infer A, infer B, infer C] ? [C, B, A] :
  // ... grows quickly, not scalable
  T
```

Approach 1 or 2 is always preferred.

## Comparison

| Approach | Style | Recursion Depth | Notes |
|----------|-------|-----------------|-------|
| Last → Front (Approach 1) | Natural | O(n) | Most readable |
| Accumulator (Approach 2) | Tail-recursive | O(n) | Mirrors functional style |
| Hardcoded overloads (Approach 3) | None | O(1) | Only for fixed-length tuples |

## Key Takeaways

- Both `[infer Head, ...infer Rest]` (front destructuring) and `[...infer Rest, infer Last]` (back destructuring) are valid in TypeScript 4.0+.
- The accumulator pattern is useful for complex tuple transformations where you want to pass state forward.
- Reversing a tuple is a foundational operation — it's used in challenges like `FlipArguments`, `Palindrome`, and `LastIndexOf`.
- TypeScript will hit recursion depth limits (~1000 levels) for very long tuples; both approaches share this limitation.
