---
date: 2026-03-29
description: TypeChallenge - 35045 - Medium - LongestCommonPrefix
title: "35045 · LongestCommonPrefix"
readingTime: true
tag:
  - TypeScript
  - TypeChallenge
  - TC-Medium
outline: [2, 3]
article: false
---

# 35045 · LongestCommonPrefix

[Challenge Link](https://tsch.js.org/35045)

## Problem

Implement `LongestCommonPrefix<T>` that takes a tuple of strings and returns their longest common prefix.

```ts
type cases = [
  Expect<Equal<LongestCommonPrefix<['flower', 'flow', 'flight']>, 'fl'>>,
  Expect<Equal<LongestCommonPrefix<['dog', 'racecar', 'race']>, ''>>,
  Expect<Equal<LongestCommonPrefix<['abc', 'abcd', 'abcde']>, 'abc'>>,
  Expect<Equal<LongestCommonPrefix<['type-challenges', 'type-hero', 'typescript']>, 'type'>>,
]
```

## Solution

```typescript
type FirstChar<S extends string> = S extends `${infer C}${string}` ? C : never

type AllStartWith<T extends string[], Prefix extends string> =
  T extends [infer Head extends string, ...infer Tail extends string[]]
    ? Head extends `${Prefix}${string}`
      ? AllStartWith<Tail, Prefix>
      : false
    : true

type NextPrefix<T extends string[], P extends string> =
  T extends [infer Head extends string, ...infer _]
    ? Head extends `${P}${infer Next}${string}`
      ? Next extends ''
        ? never
        : `${P}${FirstChar<Next>}`
      : never
    : never

type LongestCommonPrefix<T extends string[], P extends string = ''> =
  NextPrefix<T, P> extends infer NP extends string
    ? AllStartWith<T, NP> extends true
      ? LongestCommonPrefix<T, NP>
      : P
    : P
```

## Explanation

The solution grows the prefix one character at a time, checking at each step whether all strings still share it.

### Helper: `FirstChar<S>`

Extracts the first character of a string using template literal inference: `S extends \`${infer C}${string}\`` captures `C` as the first char.

### Helper: `AllStartWith<T, Prefix>`

Recursively checks every string in tuple `T` to see if it starts with `Prefix` using `Head extends \`${Prefix}${string}\``. Returns `true` only when all strings pass.

### Helper: `NextPrefix<T, P>`

Given current prefix `P`, looks at the first string of `T` and extracts what the next candidate prefix would be — i.e., `P` plus one more character.

- `Head extends \`${P}${infer Next}${string}\`` captures the remaining characters after `P`
- If `Next` is empty, there are no more characters to add → returns `never`
- Otherwise, returns `\`${P}${FirstChar<Next>}\`` — the prefix extended by one character

### Main: `LongestCommonPrefix<T, P>`

Starts with `P = ''` (empty prefix) and iterates:
1. Compute `NP = NextPrefix<T, P>` — the prefix extended by one char based on the first string
2. If `NP` is a valid string and `AllStartWith<T, NP>` is true → all strings share `NP`, recurse with `NP`
3. Otherwise → `P` is the longest common prefix, return it

The recursion terminates when the candidate next prefix is not shared by all strings, or when the first string has been fully consumed (`NextPrefix` returns `never`).

## Key Concepts

- **Template literal types** — `\`${P}${string}\`` for prefix matching and character extraction
- **`infer` in template literals** — capturing sub-strings at specific positions
- **Recursive conditional types** — iteratively building up the prefix
- **Tuple recursion** — `[infer Head, ...infer Tail]` pattern to process lists
