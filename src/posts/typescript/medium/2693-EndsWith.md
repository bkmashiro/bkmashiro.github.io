---
date: 2024-08-18
description: TypeChallenge - 2693
title: EndsWith
readingTime: true
tag:
  - TypeScript
  - TypeChallenge
  - TC-Medium
outline: [2, 3]
article: false
---

# EndsWith
[Problem Link](https://tsch.js.org/2693)

## Problem

Implement `EndsWith<T, U>` which takes two string types and returns whether `T` ends with `U`.

```ts
type R0 = EndsWith<'abc', 'bc'>  // true
type R1 = EndsWith<'abc', 'abc'> // true
type R2 = EndsWith<'abc', 'd'>   // false
```

## Solution

### Approach 1: Template Literal Pattern Match

Use a template literal to check if the string ends with `U` by matching `${string}${U}`:

```ts
type EndsWith<T extends string, U extends string> =
  T extends `${string}${U}` ? true : false
```

**How it works:**
- `${string}` matches any prefix (including the empty string).
- `${U}` must be a literal suffix.
- If the full string `T` matches this pattern, `T` ends with `U`.

This is the idiomatic, minimal TypeScript solution and covers all edge cases:
- `EndsWith<'abc', ''>` → `true` (empty suffix always matches)
- `EndsWith<'abc', 'abc'>` → `true` (exact match, prefix is `''`)
- `EndsWith<'abc', 'abcd'>` → `false`

### Approach 2: Recursive Suffix Stripping

An alternative (more verbose) approach: recursively check character by character from the end.

```ts
type EndsWith<T extends string, U extends string> =
  U extends ''
    ? true
    : T extends `${infer _}${U}`
      ? true
      : false
```

This is equivalent to Approach 1 but spells out the empty-string base case explicitly.

### Approach 3: Reverse and StartsWith

If you already have a `StartsWith` helper (e.g., from challenge 2688), you can reverse both strings:

```ts
type Reverse<S extends string> =
  S extends `${infer Head}${infer Tail}`
    ? `${Reverse<Tail>}${Head}`
    : ''

type StartsWith<T extends string, U extends string> =
  T extends `${U}${string}` ? true : false

type EndsWith<T extends string, U extends string> =
  StartsWith<Reverse<T>, Reverse<U>>
```

This is a fun composition but far less efficient than Approach 1.

## Comparison with StartsWith (2688)

`StartsWith` and `EndsWith` are mirror images of each other:

```ts
// StartsWith: prefix first
type StartsWith<T extends string, U extends string> =
  T extends `${U}${string}` ? true : false

// EndsWith: suffix last
type EndsWith<T extends string, U extends string> =
  T extends `${string}${U}` ? true : false
```

The only difference is the position of `${string}` in the template literal pattern.

## Key Takeaways

- Template literal pattern matching with `${string}` as a wildcard is extremely powerful for string suffix/prefix checks.
- This is an O(1) type-level operation — no recursion needed.
- The pattern `T extends \`${string}${U}\`` is idiomatic TypeScript for "ends with".
