---
date: 2024-08-18
description: TypeChallenge - 0007 - Easy - Readonly
title: "0007 · Readonly"
readingTime: true
tag:
  - TypeScript
  - TypeChallenge
  - TC-Easy
outline: [2, 3]
article: false
---

# 0007 · Readonly

[Challenge Link](https://tsch.js.org/7)

## Problem

Implement the built-in `Readonly<T>` generic without using it.

Constructs a type with all properties of `T` set to `readonly`, meaning the properties of the constructed type cannot be reassigned.

```ts
interface Todo {
  title: string
  description: string
}

const todo: MyReadonly<Todo> = {
  title: 'Hey',
  description: 'foobar',
}

todo.title = 'Hello' // Error: cannot reassign a readonly property
todo.description = 'barFoo' // Error: cannot reassign a readonly property
```

## Solution

```ts
type MyReadonly<T> = { readonly [K in keyof T]: T[K] }
```

## Explanation

This solution is almost identical to `Pick`, but with the `readonly` modifier applied to every property.

**Step by step:**
1. `keyof T` — produces a union of all keys of `T`
2. `[K in keyof T]` — iterates over every key `K` in `T`
3. `readonly` — marks each property as read-only
4. `T[K]` — preserves the original value type of each property

The result is a new object type where all properties are read-only. Attempting to assign a value to any property will cause a TypeScript compile error.

**Why `readonly` matters:**
TypeScript's `readonly` modifier is a compile-time check only — the JavaScript runtime doesn't enforce it. But it's extremely useful for expressing intent (e.g., immutable state, frozen config objects) and catching accidental mutations early.

**Key concepts:**
- [Mapped Types](https://www.typescriptlang.org/docs/handbook/2/mapped-types.html)
- [Readonly modifier](https://www.typescriptlang.org/docs/handbook/2/objects.html#readonly-properties)

::: tip
A normal array (`T[]`) is a **subtype** of a readonly array (`readonly T[]`), because a mutable array can do everything a readonly array can (plus mutation). This is the Liskov Substitution Principle applied to TypeScript's type system.
:::
