---
date: 2026-03-29
description: TypeChallenge - 0898 - Easy - Includes
title: "0898 · Includes"
readingTime: true
tag:
  - TypeScript
  - TypeChallenge
  - TC-Easy
outline: [2, 3]
article: false
---

# 0898 · Includes

[Challenge Link](https://tsch.js.org/898)

## Problem

Implement a type `Includes<T, U>` that checks whether `U` exists in tuple `T`.

```ts
type Result1 = Includes<['a', 'b', 'c'], 'a'> // true
type Result2 = Includes<[1, 2, 3], 4> // false
```

## Solution

```ts
type Equal<X, Y> = (<T>() => T extends X ? 1 : 2) extends
  (<T>() => T extends Y ? 1 : 2)
  ? true
  : false

type Includes<T extends readonly unknown[], U> = T extends [
  infer First,
  ...infer Rest,
]
  ? Equal<First, U> extends true
    ? true
    : Includes<Rest, U>
  : false
```

## Explanation

The tricky part is that this challenge wants strict type equality, not loose assignability.

For example:

```ts
type A = Includes<[{}], {}> // false in the official tests
```

If we only used `U extends T[number]`, this case would be wrong because `{}` is too broad and assignability is not the same as exact equality.

### Step by Step

1. Split the tuple into `First` and `Rest`.
2. Compare `First` and `U` with `Equal`.
3. If they are exactly the same type, return `true`.
4. Otherwise, recursively check the remaining elements.
5. If the tuple becomes empty, return `false`.

### Why `Equal` Is Necessary

`Equal<X, Y>` is a common utility in type challenges. It checks whether two types are exactly the same instead of just being assignable to each other.

That matters for cases like:

```ts
type A = Equal<boolean, false> // false
type B = Equal<true, true> // true
type C = Equal<{}, {}> // true
```

### Example Walkthrough

```ts
type Result = Includes<[1, 2, 3], 2>
```

This expands roughly like:

```ts
Equal<1, 2> -> false
Includes<[2, 3], 2>
Equal<2, 2> -> true
```

So the final result is `true`.

## Alternative Solutions

### Option 1: Naive Union Check

```ts
type Includes2<T extends readonly unknown[], U> = U extends T[number] ? true : false
```

This is short, but not correct for the official tests because it checks assignability, not exact equality.

### Option 2: Helper-Based Recursion

```ts
type Equal2<X, Y> = (<T>() => T extends X ? 1 : 2) extends
  (<T>() => T extends Y ? 1 : 2)
  ? true
  : false

type IncludesHelper<T extends readonly unknown[], U> = T extends [
  infer Head,
  ...infer Tail,
]
  ? Equal2<Head, U> extends true
    ? true
    : IncludesHelper<Tail, U>
  : false
```

This is the same algorithm split into smaller units, which can be easier to reuse in later tuple problems.

## Thought Process

The first instinct is usually "convert the tuple to a union and check membership." That works for value-level intuition, but it fails at the type level because membership here really means exact type equality.

So the correct direction is:

- Iterate through the tuple one item at a time.
- Compare with a strict equality helper.
- Stop early when a match is found.

This pattern shows up frequently in medium challenges too, so `Includes` is a good foundation problem.

**Key concepts:**
- [Conditional Types](https://www.typescriptlang.org/docs/handbook/2/conditional-types.html)
- [Variadic Tuple Types](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-4-0.html#variadic-tuple-types)
- Recursive tuple processing
