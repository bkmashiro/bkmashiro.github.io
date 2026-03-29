---
date: 2026-03-29
description: TypeChallenge - 9616
title: Parse URL Params
readingTime: true
tag:
  - TypeScript
  - TypeChallenge
  - TC-Medium
outline: [2, 3]
article: false
---

# Parse URL Params
[Problem Link](https://tsch.js.org/9616)

## Problem

You're required to implement a type-level parser to parse URL params string into a Union.

```ts
ParseURLParams<':id'>            // 'id'
ParseURLParams<'posts/:id'>      // 'id'
ParseURLParams<'posts/:id/:user'> // 'id' | 'user'
```

## Solution

### Approach: Template Literal Pattern Matching

Match the `:param` pattern and collect all parameter names.

```ts
type ParseURLParams<T extends string> =
  T extends `${string}:${infer Param}/${infer Rest}`
    ? Param | ParseURLParams<Rest>
    : T extends `${string}:${infer Param}`
      ? Param
      : never
```

**How it works:**
1. First try to match `...:param/rest` — extract `Param` before a `/` and recurse on `Rest`.
2. If that fails, try `...:param` at the end of the string — no trailing `/`.
3. If neither pattern matches, return `never` (no params).

The `${string}` at the start greedily consumes any prefix before `:`.

## Key Takeaways

- Two-pattern matching (with slash, without slash) handles both middle and last parameters cleanly.
- `${string}` matches zero or more characters — useful for consuming arbitrary prefixes.
- Recursion collects multiple parameters as a union via `|`.
