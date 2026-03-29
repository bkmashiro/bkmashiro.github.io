---
date: 2026-03-29
description: TypeChallenge - 0189 - Easy - Awaited
title: "0189 · Awaited"
readingTime: true
tag:
  - TypeScript
  - TypeChallenge
  - TC-Easy
outline: [2, 3]
article: false
---

# 0189 · Awaited

[Challenge Link](https://tsch.js.org/189)

## Problem

Implement a generic `MyAwaited<T>` that recursively unwraps the value inside a `Promise`.

```ts
type Example1 = MyAwaited<Promise<string>> // string
type Example2 = MyAwaited<Promise<Promise<number>>> // number
```

## Solution

```ts
type MyAwaited<T extends PromiseLike<any>> = T extends PromiseLike<infer U>
  ? U extends PromiseLike<any>
    ? MyAwaited<U>
    : U
  : never
```

## Explanation

The core idea is to repeatedly extract the resolved value type until the result is no longer promise-like.

### Step by Step

1. `T extends PromiseLike<any>` ensures the input is promise-like.
2. `T extends PromiseLike<infer U>` extracts the value inside the promise.
3. If `U` is still `PromiseLike<any>`, recurse with `MyAwaited<U>`.
4. Otherwise, return `U`.

### Why `PromiseLike`?

`PromiseLike<T>` is more general than `Promise<T>`. It matches standard promises and thenable-style objects, which is exactly what the challenge expects.

### Example Walkthrough

```ts
type Result = MyAwaited<Promise<Promise<number>>>
```

This expands as:

```ts
MyAwaited<Promise<Promise<number>>>
-> MyAwaited<Promise<number>>
-> number
```

## Alternative Solutions

### Option 1: Single-Branch Recursive Form

```ts
type MyAwaited2<T extends PromiseLike<any>> = T extends PromiseLike<infer U>
  ? U extends PromiseLike<any>
    ? MyAwaited2<U>
    : U
  : never
```

This is effectively the same logic with a different name. It is explicit and easy to read.

### Option 2: Recursive Unwrap Helper

```ts
type UnwrapPromise<T> = T extends PromiseLike<infer U> ? UnwrapPromise<U> : T
type MyAwaited3<T extends PromiseLike<any>> = UnwrapPromise<T>
```

This separates "recursive unwrapping" from the public challenge type. It is useful when the same unwrapping logic will be reused elsewhere.

## Thought Process

The challenge looks simple if we only consider `Promise<number>`, but the recursive case is the real point. A one-level unwrap is not enough because `Promise<Promise<T>>` should still produce `T`.

That naturally leads to a conditional type plus `infer`:

- Use `infer` to grab the resolved value.
- Check whether that value is still promise-like.
- Keep unwrapping until it is not.

**Key concepts:**
- [Conditional Types](https://www.typescriptlang.org/docs/handbook/2/conditional-types.html)
- [Inferring Within Conditional Types](https://www.typescriptlang.org/docs/handbook/2/conditional-types.html#inferring-within-conditional-types)
- [`PromiseLike`](https://www.typescriptlang.org/docs/handbook/utility-types.html)
