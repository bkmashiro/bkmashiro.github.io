---
date: 2026-03-29
description: TypeChallenge - 6
title: Simple Vue
readingTime: true
tag:
  - TypeScript
  - TypeChallenge
  - TC-Hard
outline: [2, 3]
article: false
---

# Simple Vue
[Problem Link](https://tsch.js.org/6)

## Problem

Implement a simplified version of a Vue-like `defineComponent` function that accepts an options object with `data`, `computed`, and `methods` properties. Each of these should have proper access to `this`:

- `data()` returns a plain object
- `computed` contains functions that return a value; `this` should have access to `data` fields and other `computed` properties
- `methods` contains functions; `this` should have access to `data` fields, `computed` values, and other methods

```ts
const instance = SimpleVue({
  data() {
    return { firstName: 'Type', lastName: 'Challenges', amount: 10 }
  },
  computed: {
    fullName() { return `${this.firstName} ${this.lastName}` }
  },
  methods: {
    hi() { alert(this.fullName.toLowerCase()) }
  }
})
```

## Solution

The key challenge is that `this` in each section must refer to different merged contexts.

```ts
declare function SimpleVue<D, C extends Record<string, () => any>, M>(options: {
  data(this: void): D
  computed: C & ThisType<D>
  methods: M & ThisType<D & { [K in keyof C]: ReturnType<C[K]> } & M>
}): any
```

**How it works:**

1. `data(this: void)` — prevents accidental `this` usage inside `data`, since it should be a pure factory.
2. `computed: C & ThisType<D>` — computed functions can access `data` fields via `this`.
3. `methods: M & ThisType<D & ComputedValues & M>` — methods can access data, computed return values, and other methods.
4. `{ [K in keyof C]: ReturnType<C[K]> }` — maps each computed property to its return type, simulating how Vue exposes computed as plain properties on the instance.

**`ThisType<T>`** is a built-in TypeScript utility that sets the type of `this` inside an object literal when used with `noImplicitThis`.

## Key Takeaways

- `ThisType<T>` is the standard TypeScript mechanism for typing `this` in option/mixin APIs.
- Mapped types over `keyof C` with `ReturnType` let you "flatten" computed getters into plain properties.
- Breaking the problem into independent generic parameters (`D`, `C`, `M`) allows TypeScript to infer each section independently before combining them.
