---
date: 2026-03-29
description: TypeChallenge - 0106 - Easy - TrimLeft
title: "0106 · TrimLeft"
readingTime: true
tag:
  - TypeScript
  - TypeChallenge
  - TC-Easy
outline: [2, 3]
article: false
---

# 0106 · TrimLeft

[Challenge Link](https://tsch.js.org/106)

## Problem

Implement `TrimLeft<T>` so it removes whitespace from the start of a string literal type.

```ts
type A = TrimLeft<"  hello"> // "hello"
type B = TrimLeft<"\n\t world"> // "world"
```

Only the left side should be trimmed. Internal spaces and trailing spaces should remain unchanged.

## Solution

```ts
type Whitespace = " " | "\n" | "\t"

type TrimLeft<S extends string> = S extends `${Whitespace}${infer Rest}`
  ? TrimLeft<Rest>
  : S
```

## Explanation

This challenge combines two important TypeScript features:

- template literal types
- recursion in conditional types

### Step by Step

1. Define the set of characters we want to treat as whitespace.
2. Check whether the string starts with one of those characters.
3. If it does, infer the rest of the string as `Rest`.
4. Recursively call `TrimLeft<Rest>`.
5. If the string does not start with whitespace, stop and return `S`.

### Why a `Whitespace` Helper?

```ts
type Whitespace = " " | "\n" | "\t"
```

This makes the pattern easier to read and easier to extend. It also mirrors how we think about the problem: "If the string starts with whitespace, remove one character and continue."

### Why Recursion Is Necessary

A single match only removes one leading character:

```ts
type RemoveOne<S extends string> = S extends `${Whitespace}${infer Rest}`
  ? Rest
  : S
```

That is not enough for:

```ts
type Example = "   hello"
```

We need to keep trimming until no leading whitespace remains, so recursion is the correct tool.

### Example Walkthrough

```ts
type Result = TrimLeft<" \n\thello">
```

This reduces roughly like:

```ts
TrimLeft<" \n\thello">
-> TrimLeft<"\n\thello">
-> TrimLeft<"\thello">
-> TrimLeft<"hello">
-> "hello"
```

The recursion stops as soon as the first character is no longer whitespace.

## Alternative Solutions

### Option 1: Inline the Whitespace Union

```ts
type TrimLeft2<S extends string> = S extends `${" " | "\n" | "\t"}${infer Rest}`
  ? TrimLeft2<Rest>
  : S
```

This behaves the same way, but pulling the union into a named helper usually improves readability.

### Option 2: Expand the Pattern Manually

```ts
type TrimLeft3<S extends string> = S extends ` ${infer Rest}`
  ? TrimLeft3<Rest>
  : S extends `\n${infer Rest}`
    ? TrimLeft3<Rest>
    : S extends `\t${infer Rest}`
      ? TrimLeft3<Rest>
      : S
```

This is valid, but it is more repetitive and harder to maintain.

## Thought Process

The phrase "remove characters from the start of a string" strongly suggests template literal matching:

```ts
S extends `${Something}${infer Rest}`
```

Then the main question becomes: what is `Something`? In this problem, it is the set of whitespace characters.

After that, the recursive shape is almost automatic:

- match one leading whitespace character
- remove it
- repeat until the match fails

This same pattern shows up again in `Trim`, `Replace`, and other string-manipulation challenges.

## Key Takeaways

- Template literal types can pattern-match string literal types.
- `infer Rest` is useful for "peeling off" part of a string.
- Recursive conditional types are a natural fit when a transformation must repeat until no match remains.

**Key concepts:**
- [Template Literal Types](https://www.typescriptlang.org/docs/handbook/2/template-literal-types.html)
- [Conditional Types](https://www.typescriptlang.org/docs/handbook/2/conditional-types.html)
- Recursive string processing
