---
date: 2026-03-29
description: TypeChallenge - 35991 - Medium - MyUppercase
title: "35991 · MyUppercase"
readingTime: true
tag:
  - TypeScript
  - TypeChallenge
  - TC-Medium
outline: [2, 3]
article: false
---

# 35991 · MyUppercase

[Challenge Link](https://tsch.js.org/35991)

## Problem

Implement `MyUppercase<T>` that converts every lowercase letter in string `T` to its uppercase equivalent, without using the built-in `Uppercase<T>`.

```ts
type cases = [
  Expect<Equal<MyUppercase<'a'>, 'A'>>,
  Expect<Equal<MyUppercase<'Z'>, 'Z'>>,
  Expect<Equal<MyUppercase<'A z h yy 😃cda\n\t  a   '>, 'A Z H YY 😃CDA\n\t  A   '>>,
]
```

## Solution

```typescript
type UpperMap = {
  'a': 'A', 'b': 'B', 'c': 'C', 'd': 'D', 'e': 'E', 'f': 'F', 'g': 'G', 'h': 'H',
  'i': 'I', 'j': 'J', 'k': 'K', 'l': 'L', 'm': 'M', 'n': 'N', 'o': 'O', 'p': 'P',
  'q': 'Q', 'r': 'R', 's': 'S', 't': 'T', 'u': 'U', 'v': 'V', 'w': 'W', 'x': 'X',
  'y': 'Y', 'z': 'Z'
}

type MyUppercase<T extends string> =
  T extends `${infer C}${infer Rest}`
    ? C extends keyof UpperMap
      ? `${UpperMap[C]}${MyUppercase<Rest>}`
      : `${C}${MyUppercase<Rest>}`
    : T
```

## Explanation

The solution uses a **lookup table** (`UpperMap`) and **template literal recursion** to process the string character by character.

### The Lookup Table

`UpperMap` is a plain object type mapping each lowercase letter to its uppercase counterpart. This avoids any built-in utilities and makes the mapping explicit and inspectable.

### The Recursion

`MyUppercase<T>` splits `T` into the first character `C` and the remaining string `Rest` using template literal `infer`:

```
T extends `${infer C}${infer Rest}`
```

TypeScript greedily matches: `C` gets the first character, `Rest` gets everything after.

- If `C` is a lowercase letter (`C extends keyof UpperMap`): substitute `UpperMap[C]` (the uppercase version) and recurse on `Rest`.
- Otherwise (uppercase letters, digits, spaces, emoji, newlines, etc.): keep `C` as-is and recurse on `Rest`.
- Base case: if `T` is empty (no match for the template), return `T` unchanged.

**Why not use `Uppercase<C>`?**

The challenge asks us to implement it manually. The `UpperMap` approach is conceptually equivalent — a finite lookup table covers all 26 lowercase letters.

**Performance note:** Template literal recursion in TypeScript can hit depth limits for very long strings. For typical usage this is fine; TypeScript limits recursive types to ~100 levels by default.

## Key Concepts

- **Template literal `infer`** — splitting strings into head and tail characters
- **Object type as lookup table** — `Type[Key]` for constant-time char mapping
- **Recursive template literal types** — building strings char-by-char at the type level
- **Identity passthrough** — non-mapped characters (uppercase, symbols, whitespace) are preserved unchanged
