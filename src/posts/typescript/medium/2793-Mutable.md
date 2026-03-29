---
date: 2024-08-18
description: TypeChallenge - 2793
title: Mutable
readingTime: true
tag:
  - TypeScript
  - TypeChallenge
  - TC-Medium
outline: [2, 3]
article: false
---

# Mutable
[Problem Link](https://tsch.js.org/2793)

## Problem

Implement the generic `Mutable<T>` which makes all properties in `T` mutable (removes `readonly`).

```ts
interface Todo {
  readonly title: string
  readonly description: string
  readonly completed: boolean
}

type MutableTodo = Mutable<Todo>
// {
//   title: string
//   description: string
//   completed: boolean
// }
```

## Solution

### Approach 1: Mapped Type with `-readonly` Modifier

The most direct solution uses TypeScript's `-readonly` modifier in a mapped type to strip the `readonly` qualifier from every property:

```ts
type Mutable<T extends object> = {
  -readonly [K in keyof T]: T[K]
}
```

**How it works:**
- `[K in keyof T]` iterates over all keys of `T`.
- `-readonly` removes the `readonly` modifier from each property.
- `T[K]` preserves the original value type unchanged.

This is the idiomatic, one-liner solution.

### Approach 2: Using `as` Remapping (explicit)

You can make the remapping more explicit with `as`:

```ts
type Mutable<T extends object> = {
  -readonly [K in keyof T as K]: T[K]
}
```

This is functionally identical to Approach 1 but shows the key remapping step explicitly. Useful when you also want to filter or rename keys.

### Approach 3: Utility Type Composition

If you already have built-in `Required` in scope, you might be tempted to combine it, but `Required` only removes `?` (optionality), not `readonly`. There's no built-in `Mutable` in TypeScript's standard library — that's exactly why this challenge exists!

For reference, the mirror type `Readonly<T>` from the standard library adds `readonly`:
```ts
// Standard library Readonly (adds readonly):
type Readonly<T> = {
  readonly [K in keyof T]: T[K]
}

// Our Mutable (removes readonly):
type Mutable<T extends object> = {
  -readonly [K in keyof T]: T[K]
}
```

### Approach 4: Deep Mutable

The challenge only asks for shallow mutability, but in practice you often need recursion:

```ts
type DeepMutable<T> = T extends object
  ? { -readonly [K in keyof T]: DeepMutable<T[K]> }
  : T
```

This recursively removes `readonly` from nested objects as well.

## Key Takeaways

- TypeScript supports `+` and `-` prefixes on mapped type modifiers (`readonly` and `?`).
- `-readonly` removes the readonly modifier; `+readonly` (or just `readonly`) adds it.
- `-?` removes optionality (same as `Required<T>`); `+?` adds it.
- The standard library has no `Mutable<T>` — you need to write it yourself.

| Modifier | Effect |
|----------|--------|
| `readonly` or `+readonly` | Make property readonly |
| `-readonly` | Remove readonly |
| `?` or `+?` | Make property optional |
| `-?` | Make property required |
