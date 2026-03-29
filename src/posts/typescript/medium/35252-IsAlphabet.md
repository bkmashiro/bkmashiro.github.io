---
date: 2026-03-29
description: TypeChallenge - 35252 - Medium - IsAlphabet
title: "35252 · IsAlphabet"
readingTime: true
tag:
  - TypeScript
  - TypeChallenge
  - TC-Medium
outline: [2, 3]
article: false
---

# 35252 · IsAlphabet

[Challenge Link](https://tsch.js.org/35252)

## Problem

Implement `IsAlphabet<S>` that returns `true` if `S` is a single alphabetic character (a–z or A–Z), and `false` otherwise.

```ts
type cases = [
  Expect<Equal<IsAlphabet<'A'>, true>>,
  Expect<Equal<IsAlphabet<'z'>, true>>,
  Expect<Equal<IsAlphabet<'9'>, false>>,
  Expect<Equal<IsAlphabet<'!'>, false>>,
  Expect<Equal<IsAlphabet<'😂'>, false>>,
  Expect<Equal<IsAlphabet<''>, false>>,
]
```

## Solution

```typescript
type LowerAlphabet = 'a' | 'b' | 'c' | 'd' | 'e' | 'f' | 'g' | 'h' | 'i' | 'j' | 'k' | 'l' | 'm' |
  'n' | 'o' | 'p' | 'q' | 'r' | 's' | 't' | 'u' | 'v' | 'w' | 'x' | 'y' | 'z'
type UpperAlphabet = Uppercase<LowerAlphabet>
type Alphabet = LowerAlphabet | UpperAlphabet

type IsAlphabet<S extends string> =
  S extends Alphabet ? true : false
```

## Explanation

The solution enumerates all 26 lowercase letters as a union type, then derives the uppercase equivalents using the built-in `Uppercase<T>` utility, and finally checks membership.

**Step by step:**

1. `LowerAlphabet` — a union of all 26 lowercase letter string literals: `'a' | 'b' | ... | 'z'`

2. `UpperAlphabet = Uppercase<LowerAlphabet>` — TypeScript's built-in `Uppercase` distributes over unions, so this produces `'A' | 'B' | ... | 'Z'` automatically without listing all 26.

3. `Alphabet = LowerAlphabet | UpperAlphabet` — the full alphabet, 52 members.

4. `S extends Alphabet ? true : false` — a simple membership check. If `S` is one of the 52 literal types, return `true`; otherwise `false`.

**Why this works:**
- TypeScript string literal types support exact equality: `'a' extends 'a' | 'b' | 'c'` resolves to `true`.
- The empty string `''` is not in the union → `false`.
- Multi-char strings like `'ab'` are not in the union → `false`.
- Non-letter chars like `'9'`, `'!'`, `'😂'` are not in the union → `false`.

**Alternative approach:** One could use template literal magic like `S extends \`${infer C}\`` combined with character ranges, but TypeScript doesn't support character ranges natively. The explicit enumeration is clean and efficient.

## Key Concepts

- **String literal union types** — enumerating exact values as a type
- **`Uppercase<T>` utility** — built-in mapped string manipulation that distributes over unions
- **Conditional type membership check** — `S extends Union ? true : false`
