---
date: 2026-03-29
description: TypeChallenge - 4803
title: Trim Right
readingTime: true
tag:
  - TypeScript
  - TypeChallenge
  - TC-Medium
outline: [2, 3]
article: false
---

# Trim Right
[Problem Link](https://tsch.js.org/4803)

## Problem

Implement `TrimRight<T>` which takes an exact string type and returns a new string with the whitespace ending removed.

```ts
type Trimed = TrimRight<'   Hello World    '> // '   Hello World'
```

## Solution

### Approach: Recursive Suffix Stripping

Check if the string ends with a whitespace character; if so, strip it and recurse.

```ts
type Whitespace = ' ' | '\n' | '\t'

type TrimRight<S extends string> =
  S extends `${infer Rest}${Whitespace}`
    ? TrimRight<Rest>
    : S
```

**How it works:**
1. Pattern match `S` as `${Rest}${Whitespace}` — i.e., any string ending with a whitespace character.
2. If it matches, strip the trailing whitespace and recurse on `Rest`.
3. If it doesn't match (no trailing whitespace), return `S` as-is.

## Key Takeaways

- `TrimRight` is the mirror of `TrimLeft` — just move the whitespace check to the suffix position.
- Template literal inference is greedy from the left, so `${infer Rest}${Whitespace}` correctly captures everything before the last whitespace character.
- Combining `TrimLeft` and `TrimRight` gives you a full `Trim` implementation.
