---
description: TypeChallenge - Easy Series
title: TypeChallenge - Easy Series
readingTime: true
tag:
  - TypeScript
  - TypeChallenge
outline: [2, 3]  
sticky: 3  
---

# TypeChallenge - Easy Series

## Introduction

In this chapter, we'll quickly go through all the easy series TypeChallenges.

I'll share my thought process, code, and some additional notes.

## Warm-up

Let's start with a warm-up problem labeled as `warm` difficulty.

### 013 - Hello World

[013 - Hello World](https://github.com/type-challenges/type-challenges/blob/main/questions/00013-warm-hello-world/README.md)

```ts
/* _____________ My Code _____________ */
type HelloWorld = string; // expected to be a string

/* _____________ Test Cases _____________ */
import type { Equal, Expect, NotAny } from "@type-challenges/utils";

type cases = [Expect<NotAny<HelloWorld>>, Expect<Equal<HelloWorld, string>>];
```

TypeChallenge requires us to write a type that satisfies a given condition. The correctness of our code will be verified through test cases.

The challenge here is to write a type `HelloWorld` that is a string.

I wrote:

```ts
type HelloWorld = string;
```

And that’s it, the challenge is completed.

The test cases include two assertions:

1. `Expect<NotAny<HelloWorld>>` expects `HelloWorld` not to be of type `any`.
2. `Expect<Equal<HelloWorld, string>>` expects `HelloWorld` to be a string.

TypeScript infers this correctly, and no errors appear in my editor, proving that I am correct.

::: tip
In the following content, I won't repeat the original problems and test cases, but I'll provide links to each challenge.
:::

## Easy Series

Next up are the easy series challenges.

They are:

- 004 - Implement Pick
- 014 - First of Array
- 189 - Awaited
- 898 - Includes
- 3312 - Parameters
- 7 - Readonly
- 18 - Length of Tuple
- 268 - If
- 57 - Push
- 3060 - Unshift
- 533 - Concat
- 43 - Exclude
- 11 - Tuple to Object

---

### 004 - Implement Pick

[004 - Pick](https://github.com/type-challenges/type-challenges/blob/main/questions/00004-easy-pick/README.md)

We need to implement a `Pick` type that extracts properties from `T` based on `K`.

We’ll use the knowledge of [Mapped Types](https://www.typescriptlang.org/docs/handbook/2/mapped-types.html).

> A Mapped Type is an advanced TypeScript type that creates new types by mapping over the properties of an existing type.

Naturally, I thought of a `for in` loop.

If a property is in `K`, extract it from `T`.

So I wrote the following code:

```ts
type MyPick<T, K> = { [P in K]: T[P] };
```

But TypeScript prompts that `P` cannot be used to index `T`. What's going on?

Imagine the following scenario:

```ts
type T = {
  a: string;
  b: number;
};

type K = "c" | "d";
```

The properties `c` and `d` in `K` don't exist in `T`, but we attempt to access them in `P`. This is unsafe.

So, we need to constrain `K` to the keys of `T`.

That is, `K extends keyof T`.

I then wrote the following code:

```ts
type MyPick<T, K extends keyof T> = { [P in K]: T[P] };
```

And that’s it, the challenge is completed.

---

### 014 - First of Array

[014 - First](https://github.com/type-challenges/type-challenges/blob/main/questions/00014-easy-first/README.md)

This challenge asks us to write a type `First<T>` so that `First<[1, 2, 3]>` results in `1`.

Many might think of using an index to access the first element of the array.

```ts
type First<T extends any[]> = T[0];
```

This works in most cases, but when the array is empty, it extracts `undefined`, while we expect `never`.

Here's my solution:

```ts
type First<T extends any[]> = T extends [] ? never : T[0];
```

If `T` is an empty array, return `never`; otherwise, return the first element.

Alternatively, we can use the `infer` keyword to solve this problem. (The `infer` keyword might be a bit difficult to understand, so here's an example)

<details>
<summary>Click to see the infer example</summary>

```ts
type Infer<T> = T extends Promise<infer R> ? R : never;
```

> The `infer` keyword introduces a new type variable within a conditional type statement, attempting to infer its type.

For example, if `T` is `Promise<number>`, then `R` is `number`.

Since `T` is `Promise<number>`, when `R` is `number`, `Promise<number>` is `Promise<R>`, so `T extends Promise<infer R>` holds true.

TypeScript helps us infer that `R` is `number`. We can then use `R` in the subsequent code.

This is the role of `infer`.

If TypeScript cannot infer `R`, then `T` is not a `Promise` type, so it returns `never`.

</details>

If readers are unfamiliar with the `extends ? :` syntax, they can check the [conditional types](https://www.typescriptlang.org/docs/handbook/2/conditional-types.html) documentation.

To explain briefly:

- `T extends [] ? never : T[0]` is a conditional type.
- `T extends []` is a condition. If `T` is an empty array, it returns `never`; otherwise, it returns `T[0]`.

So the following implementation is also correct:

```ts
type First<T extends readonly any[]> = T extends [infer F, ...infer R]
  ? F
  : never;
```

If `T` is a non-empty array, return the first element; otherwise, return `never`.

Here, I use `readonly any[]` to represent an array, meaning `T` can be either an array (`any[]`) or a tuple (`readonly any[]`).

::: tip
`readonly` is a read-only array type used to enforce immutability.
:::

::: warning
A fact: Which one is a subtype of the other: a readonly array or a normal array?

Answer: A normal array is a subtype of a readonly array.

Because a readonly array is immutable and cannot be modified, but a normal array can be read and written, the behavior of a normal array is broader, making it a subtype of a readonly array.

Subtypes have more behaviors than their supertypes.
:::

And that’s it, the challenge is completed.

---

### 189 - Awaited

[189 - Awaited](https://github.com/type-challenges/type-challenges/blob/main/questions/00189-easy-awaited/README.zh-CN.md)

This challenge asks us to write a type `Awaited<T>` so that `Awaited<Promise<number>>` results in `number`.

It's important to note that if `T` is not a `Promise`, it should return `T`. If `T` is a `Promise`, it should return the result of the `Promise`. If `T` is a `Promise<Promise<number>>`, it should return `number` (i.e., recursively unwrap the promise).

Here, I used the `infer` keyword mentioned earlier to extract the result of `Promise<?>`.

I wrote:

```ts
type MyAwaited<T extends PromiseLike<any>> = T extends PromiseLike<infer V>
  ? V extends PromiseLike<any>
    ? MyAwaited<V>
    : V
  : never;
```

I used a utility type called `PromiseLike` here to constrain the `Promise` type.

```ts
interface PromiseLike<T> {
  /**
   * Attaches callbacks for the resolution and/or rejection of the Promise.
   * @param onfulfilled The callback to execute when the Promise is resolved.
   * @param onrejected The callback to execute when the Promise is rejected.
   * @returns A Promise for the completion of whichever callback is executed.
   */
  then<TResult1 = T, TResult2 = never>(
    onfulfilled?:
      | ((value: T) => TResult1 | PromiseLike<TResult1>)
      | undefined
      | null,
    onrejected?:
      | ((reason: any) => TResult2 | PromiseLike<TResult2>)
      | undefined
      | null
  ): PromiseLike<TResult1 | TResult2>;
}
```

Any type that behaves like a `Promise` is considered a `Promise` type. `PromiseLike` is a generic interface used to constrain `Promise` types.

Now, consider the following scenario:

```ts
MyAwaited<V>;
```

For this `V`, we discuss the following two cases:

- (recursive) If `V` is `PromiseLike<any>`, then we continue unwrapping.
- (base) If `V` is not `PromiseLike<any>`, then we return `V`.

So we write:

- If `V` is `PromiseLike<U>`, then return `MyAwaited<U>`. (Recursive condition, continue recursively unwrapping)

  For example

, if `V` is `Promise<number>`, then `U` is `number`.

- If `V` is not `PromiseLike<any>`, then return `V`. (Base condition, stop recursion)

In the end, the first level of recursion extracts `U` from the `Promise`, the second level extracts `U` from `PromiseLike<U>`, and finally, we return `V`.

We get `MyAwaited<Promise<number>>` as `number`, completing the challenge.

---

### 898 - Includes

[898 - Includes](https://github.com/type-challenges/type-challenges/blob/main/questions/00898-easy-includes/README.md)

This challenge asks us to write a type `Includes<T extends readonly any[], U>` so that `Includes<[1, 2, 3], 2>` results in `true`, and `Includes<[1, 2, 3], 4>` results in `false`.

This problem is similar to array operations, specifically the `includes` method of an array. We need to determine whether a value `U` is present in an array `T`.

The logic here is simple. We can iterate over the array, check whether any element is equal to `U`, and return `true` or `false`.

In the test cases, I noticed a tricky one:

```ts
type cases = [
  Expect<Equal<Includes<["a", "b", "c"], "a">, true>>,
  Expect<Equal<Includes<["a", "b", "c"], "d">, false>>,
  Expect<Equal<Includes<[1, 2, 3], 2>, true>>,
  Expect<Equal<Includes<[1, 2, 3], 4>, false>>,
  Expect<Equal<Includes<[1, 2, 3, 5, 6, 7], 7>, true>>,
  Expect<Equal<Includes<[1, 2, 3, 5, 6, 7], 8>, false>>,
  Expect<Equal<Includes<[{}], {}>, false>>,
  Expect<Equal<Includes<[boolean, 2, 3, 5, 6, 7], false>, false>>,
  Expect<Equal<Includes<[boolean, 2, 3, 5, 6, 7], true>, false>>,
  Expect<Equal<Includes<[true, 2, 3, 5, 6, 7], true>, true>>,
  Expect<Equal<Includes<[false, 2, 3, 5, 6, 7], false>, true>>
];
```

If the array contains an object (like `{}`), even if `U` is `{}`, the result should be `false` since they are different objects in memory. We should return `false`.

For this problem, I didn't use the `extends` method but utilized the `infer` keyword mentioned earlier to extract the head and tail of the array.

I wrote the following code:

```ts
type Includes<T extends readonly any[], U> = T extends [infer F, ...infer R]
  ? Equal<F, U> extends true
    ? true
    : Includes<R, U>
  : false;
```

When the `Equal<F, U>` condition returns true, we return true; otherwise, we recursively check the rest of the array (`Includes<R, U>`). If the recursion ends without finding `U`, we return false.

This approach is clear and readable, and it solves the problem.

---

### 3312 - Parameters

[3312 - Parameters](https://github.com/type-challenges/type-challenges/blob/main/questions/03312-easy-parameters/README.md)

This challenge asks us to write a type `MyParameters<T extends (...args: any[]) => any>` so that `MyParameters<fn>` results in `[number, string]` where `fn` is `(arg1: number, arg2: string) => void`.

This problem is similar to the built-in `Parameters` utility type in TypeScript.

We need to extract the parameter types of a function.

I wrote:

```ts
type MyParameters<T extends (...args: any[]) => any> = T extends (
  ...args: infer P
) => any
  ? P
  : never;
```

If `T` is a function type, we use `infer` to infer the parameters (`P`). Then, we return `P`. If `T` is not a function, we return `never`.

---

### 7 - Readonly

[7 - Readonly](https://github.com/type-challenges/type-challenges/blob/main/questions/00007-easy-readonly/README.md)

This challenge asks us to implement a `Readonly` utility type that takes an object `T` and returns a new object where all properties are read-only.

This problem is similar to the built-in `Readonly` utility type in TypeScript.

Here's my solution:

```ts
type MyReadonly<T> = { readonly [K in keyof T]: T[K] };
```

We iterate over the keys of `T` using a mapped type and apply `readonly` to each property.

---

### 18 - Length of Tuple

[18 - Length of Tuple](https://github.com/type-challenges/type-challenges/blob/main/questions/00018-easy-tuple-length/README.md)

This challenge asks us to write a type `Length<T>` so that `Length<[1, 2, 3]>` results in `3`.

This problem is straightforward. We can use the `length` property of a tuple to determine its length.

```ts
type Length<T extends readonly any[]> = T["length"];
```

We constrain `T` to be a tuple or array and then return its length.

---

### 268 - If

[268 - If](https://github.com/type-challenges/type-challenges/blob/main/questions/00268-easy-if/README.md)

This challenge asks us to write a type `If<C, T, F>` so that `If<true, "a", "b">` results in `"a"`.

This problem is straightforward. We can use a conditional type to determine whether `C` is true or false.

```ts
type If<C extends boolean, T, F> = C extends true ? T : F;
```

If `C` is true, return `T`; otherwise, return `F`.

---

### 57 - Push

[57 - Push](https://github.com/type-challenges/type-challenges/blob/main/questions/00057-easy-push/README.md)

This challenge asks us to write a type `Push<T, U>` so that `Push<[1, 2], 3>` results in `[1, 2, 3]`.

This problem is straightforward. We can use the spread operator to add an element to an array.

```ts
type Push<T extends any[], U> = [...T, U];
```

We spread the elements of `T` and add `U` to the end.

---

### 3060 - Unshift

[3060 - Unshift](https://github.com/type-challenges/type-challenges/blob/main/questions/03060-easy-unshift/README.md)

This challenge asks us to write a type `Unshift<T, U>` so that `Unshift<[1, 2], 0>` results in `[0, 1, 2]`.

This problem is similar to the `Push` challenge but involves adding an element to the beginning of an array.

```ts
type Unshift<T extends any[], U> = [U, ...T];
```

We add `U` to the beginning of `T` and spread the elements of `T`.

---

### 533 - Concat

[533 - Concat](https://github.com/type-challenges/type-challenges/blob/main/questions/00533-easy-concat/README.md)

This challenge asks us to write a type `Concat<T, U>` so that `Concat<[1], [2]>` results in `[1, 2]`.

This problem is similar to the `Push` and `Unshift` challenges but involves concatenating two arrays.

```ts
type Concat<T extends any[], U extends any[]> = [...T, ...U];
```

We spread the elements of `T` and `U` into a new array.

---

### 43 - Exclude

[43 - Exclude](https://github.com/type-challenges/type-challenges/blob/main/questions/00043-easy-exclude/README.md)

This challenge asks us to write a type `MyExclude<T, U>` that excludes the types in `U` from `T`.

This problem is similar to the built-in `Exclude` utility type in TypeScript.

```ts
type MyExclude<T, U> = T extends U ? never : T;
```

We use a conditional type to exclude the types in `U` from `T`.

---

### 11 - Tuple to Object

[11 - Tuple to Object](https://github.com/type-challenges/type-challenges/blob/main/questions/00011-easy-tuple-to-object/README.md)

This challenge asks us to write a type `TupleToObject<T>` that converts a tuple `T` into an object with the tuple values as keys and the tuple values as the corresponding values.

This problem is straightforward. We can use a mapped type to iterate over the elements of `T` and create an object.

```ts
type TupleToObject<T extends readonly any[]> = {
  [K in T[number]]: K;
};
```

We iterate over the elements of `T` using `T[number]` and create an object where each key is a tuple value and each value is the corresponding tuple value.

---

## Conclusion

These challenges cover fundamental Type

Script concepts like conditional types, mapped types, tuple manipulation, and more. Working through them has deepened my understanding of TypeScript's type system and has helped me appreciate its power and flexibility. Each challenge builds on the previous ones, reinforcing the concepts and techniques necessary for mastering TypeScript.