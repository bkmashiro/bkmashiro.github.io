---
date: 2026-03-29
description: TypeChallenge - 3196
title: Flip Arguments
readingTime: true
tag:
  - TypeScript
  - TypeChallenge
  - TC-Medium
outline: [2, 3]
article: false
---

# Flip Arguments
[Challenge Link](https://tsch.js.org/3196)

## Challenge

Implement the type version of lodash's `_.flip`.

Type `FlipArguments<T>` requires a function type `T` and returns a new function type with the same return type but with the argument order reversed.

```ts
type Flipped = FlipArguments<(a: string, b: number, c: boolean) => void>
// (a: boolean, b: number, c: string) => void
```

## Solution

```ts
type Reverse<T extends any[]> = T extends [...infer Init, infer Last]
  ? [Last, ...Reverse<Init>]
  : []

type FlipArguments<T extends (...args: any[]) => any> =
  T extends (...args: infer Args) => infer R
    ? (...args: Reverse<Args>) => R
    : never
```

## Analysis

The problem breaks into two clear sub-problems:

1. **Reverse a tuple** — flip the order of elements in a parameter list
2. **Reconstruct the function** — wrap the reversed tuple back into a function signature

### Step 1: Reversing a tuple

```ts
type Reverse<T extends any[]> = T extends [...infer Init, infer Last]
  ? [Last, ...Reverse<Init>]
  : []
```

This is a classic tail-recursive tuple reversal:
- Extract the **last element** (`Last`) and the rest (`Init`) using `infer`
- Build the result by putting `Last` first, then recursing on `Init`
- Base case: empty array → return `[]`

Example trace for `Reverse<[string, number, boolean]>`:
```
Reverse<[string, number, boolean]>
= [boolean, ...Reverse<[string, number]>]
= [boolean, number, ...Reverse<[string]>]
= [boolean, number, string, ...Reverse<[]>]
= [boolean, number, string]
```

### Step 2: Reconstructing the function

```ts
type FlipArguments<T extends (...args: any[]) => any> =
  T extends (...args: infer Args) => infer R
    ? (...args: Reverse<Args>) => R
    : never
```

Using `infer`, we extract both the argument tuple `Args` and the return type `R`, then reconstruct the function with `Reverse<Args>` as the new parameter list.

## Alternative Approach: Inline reversal

If you prefer not to define a separate `Reverse` helper, you can inline it with a slightly different technique using a second accumulator parameter:

```ts
type ReverseAcc<T extends any[], Acc extends any[] = []> =
  T extends [infer First, ...infer Rest]
    ? ReverseAcc<Rest, [First, ...Acc]>
    : Acc

type FlipArguments<T extends (...args: any[]) => any> =
  T extends (...args: infer Args) => infer R
    ? (...args: ReverseAcc<Args>) => R
    : never
```

The accumulator approach builds the reversed array **head-first** rather than tail-first, which can be slightly more readable and avoids deep spread operations.

### Which is faster?

For TypeScript's type checker, both are O(n) recursive steps. The accumulator version avoids the `...Reverse<Init>` spread at each level, so it's marginally more efficient for very long tuples. In practice the difference is negligible.

## Edge Cases

```ts
// No arguments → empty tuple reversed is still empty
type T0 = FlipArguments<() => void>
// () => void ✓

// Single argument → unchanged
type T1 = FlipArguments<(a: string) => string>
// (a: string) => string ✓

// Two arguments → swapped
type T2 = FlipArguments<(a: string, b: number) => boolean>
// (a: number, b: string) => boolean ✓
```

Note: TypeScript preserves the parameter **names** from the spread types, not from the original. The names like `a`, `b`, `c` in the output are inherited from `Reverse`'s result tuple positions.

## Key Takeaways

- **`[...infer Init, infer Last]`** extracts the tail of a tuple — useful for reversed iteration
- **`[infer First, ...infer Rest]`** extracts the head — useful for forward iteration
- Combining `infer` on arguments + return type lets you surgically transform function signatures
- Building a `Reverse` utility type is a common pattern worth keeping in your TypeScript toolkit
