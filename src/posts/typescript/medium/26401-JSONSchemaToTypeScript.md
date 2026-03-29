---
date: 2024-08-18
description: TypeChallenge - 26401
title: JSON Schema to TypeScript
readingTime: true
tag:
  - TypeScript
  - TypeChallenge
  - TC-Medium
outline: [2, 3]
article: false
---

# JSON Schema to TypeScript
[Problem Link](https://tsch.js.org/26401)

## Problem

Implement `JSONSchema2TS` which converts a JSON Schema type into a TypeScript type.

```ts
type A = JSONSchema2TS<{ type: 'string' }>            // string
type B = JSONSchema2TS<{ type: 'number' }>            // number
type C = JSONSchema2TS<{ type: 'boolean' }>           // boolean
type D = JSONSchema2TS<{ type: 'null' }>              // null
type E = JSONSchema2TS<{
  type: 'object'
  properties: {
    name: { type: 'string' }
    age:  { type: 'number' }
  }
  required: ['name']
}>
// { name: string; age?: number }
type F = JSONSchema2TS<{
  type: 'array'
  items: { type: 'string' }
}>                                                     // string[]
```

## Solution

```ts
type JSONSchema2TS<T> =
  T extends { type: 'string' }
    ? string
    : T extends { type: 'number' }
      ? number
      : T extends { type: 'boolean' }
        ? boolean
        : T extends { type: 'null' }
          ? null
          : T extends { type: 'array'; items: infer Items }
            ? JSONSchema2TS<Items>[]
            : T extends { type: 'object'; properties: infer Props; required: infer Req extends string[] }
              ? {
                  [K in keyof Props as K extends Req[number] ? K : never]: JSONSchema2TS<Props[K]>
                } & {
                  [K in keyof Props as K extends Req[number] ? never : K]?: JSONSchema2TS<Props[K]>
                }
              : T extends { type: 'object'; properties: infer Props }
                ? { [K in keyof Props]?: JSONSchema2TS<Props[K]> }
                : T extends { type: 'object' }
                  ? Record<string, unknown>
                  : never
```

**How it works:**
1. Match scalar types (`string`, `number`, `boolean`, `null`) directly.
2. For arrays, recurse on `items`.
3. For objects with `properties` and `required`, split keys into required (no `?`) and optional (with `?`) using two mapped types intersected together.
4. If no `required` is present, all properties are optional.
5. An object with no `properties` maps to `Record<string, unknown>`.

## Key Takeaways

- Splitting required vs optional properties requires two separate mapped types (one for each set) combined with `&`.
- `K extends Req[number]` tests membership in the `required` array union.
- Recursive schema resolution mirrors how JSON Schema itself is recursive.
