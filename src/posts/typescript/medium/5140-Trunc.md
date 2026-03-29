---
date: 2026-03-29
description: TypeChallenge - 5140
title: Trunc
readingTime: true
tag:
  - TypeScript
  - TypeChallenge
  - TC-Medium
outline: [2, 3]
article: false
---

# Trunc
[Challenge Link](https://tsch.js.org/5140)

## Challenge

Implement the type `Trunc<T>` which takes a string or number and returns the integer part — removing any digits after the decimal point (including the decimal point itself).

```ts
type A = Trunc<12.34>  // '12'
type B = Trunc<-5.1>   // '-5'
type C = Trunc<0.1>    // '0'
type D = Trunc<1>      // '1'
```

Note that the return type is always a **string**.

## Solution

```ts
type Trunc<T extends string | number> =
  `${T}` extends `${infer Int}.${string}`
    ? Int
    : `${T}`
```

## Analysis

### Converting to string first

Since TypeScript's type system can't perform arithmetic on number literals directly, we convert the input to its string representation via template literal: `` `${T}` ``.

For example:
- `12.34` → `"12.34"`
- `-5.1` → `"-5.1"`
- `1` → `"1"`

### Pattern matching on the decimal point

```ts
`${T}` extends `${infer Int}.${string}`
```

This pattern checks whether the stringified number contains a dot:
- If it does: `Int` captures everything **before** the dot — the integer part.
- If it doesn't: the number is already an integer, return `` `${T}` `` directly.

### Why `Int` rather than a number type?

The challenge specifies that the return type should be a **string literal type**, not a number. This simplifies things since we don't need to convert back. The `infer Int` already gives us the string literal.

## Trace Examples

| Input | `\`${T}\`` | Has `.`? | Result |
|-------|------------|----------|--------|
| `12.34` | `"12.34"` | Yes | `"12"` |
| `-5.1` | `"-5.1"` | Yes | `"-5"` |
| `0.1` | `"0.1"` | Yes | `"0"` |
| `1` | `"1"` | No | `"1"` |
| `-0` | `"0"` or `"-0"` | No | `"0"` |

### The `-0` case

In JavaScript, `-0` is a special value. However, when coerced to a string via template literals in TypeScript's type system:

```ts
type T = `${-0}`  // "0"
```

TypeScript normalizes `-0` to `"0"`, so it's handled correctly without any special case.

## Alternative Approach: Split helper

If you prefer explicit string splitting utilities:

```ts
type StringSplit<S extends string, D extends string> =
  S extends `${infer Left}${D}${infer Right}`
    ? [Left, Right]
    : [S]

type Trunc<T extends string | number> =
  StringSplit<`${T}`, '.'> extends [infer Int, ...any[]]
    ? Int
    : `${T}`
```

This uses a generic `StringSplit` that splits a string on a delimiter and returns a tuple. We then take the first element. It's more verbose but shows how general splitting utilities compose.

## Alternative Approach: Number arithmetic (doesn't work!)

You might wonder why not just use `Math.trunc` semantics in the type system:

```ts
// ❌ This doesn't work — TypeScript can't do division or floor operations
type Trunc<T extends number> = /* T - (T % 1) */ never
```

TypeScript's type system has no notion of modulo, division, or floor for arbitrary number literals. String pattern matching is the standard workaround for number manipulation in types.

## Edge Cases

```ts
// Already integer string input
type T1 = Trunc<'42'>      // '42' ✓
type T2 = Trunc<'-0'>      // '-0' ✓ (string input preserved)
type T3 = Trunc<'0.0'>     // '0' ✓

// Negative decimals
type T4 = Trunc<-1.5>      // '-1' ✓

// Large numbers
type T5 = Trunc<999.999>   // '999' ✓
```

## Key Takeaways

- **Template literals** are the bridge between number literal types and string manipulation in TypeScript
- **`` `${T}` extends `${infer Int}.${string}` ``** is the idiomatic way to extract the integer part of a decimal number as a string
- TypeScript cannot do arithmetic on number literals — string pattern matching is the workaround
- The return type is `string`, not `number`, which avoids the need for a string-to-number conversion step
