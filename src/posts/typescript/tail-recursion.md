---
description: Tail Recursion
title: Tail Recursion
readingTime: true
tag:
  - TypeScript
  - Algorithm
outline: [2, 3]
---

# Tail Recursion
<!-- more -->

## Introduction

> 尾递归是一种特殊的递归形式，它在递归调用的最后一步执行。在尾递归中，递归调用是函数的最后一个操作。尾递归的优点是可以通过编译器优化为迭代形式，从而避免栈溢出。

## Example

考虑下面的计算斐波那契数列的场景：

$$
\begin{aligned}
fib(0) & = 0 \\
fib(1) & = 1 \\
fib(n) & = fib(n-1) + fib(n-2)
\end{aligned}
$$
```ts
function fib(n: number): number {
  if (n <= 1) return n;
  return fib(n - 1) + fib(n - 2);
}
```
这是一个典型的递归场景，但是这种递归会导致栈溢出（当n特别大时）。

因为计算`fib(n)`时，需要计算`fib(n-1)`和`fib(n-2)`，而计算`fib(n-1)`时，又需要计算`fib(n-2)`和`fib(n-3)`，这样递归调用会一直往下传递，直到`n`为0或1时，才会开始计算。这会导致我们存储非常多的中间结果，占用大量的内存。

我们可以通过尾递归的方式来解决这个问题。

```ts
function fib(n: number, a = 0, b = 1): number {
  if (n === 0) return a;
  return fib(n - 1, b, a + b);
}
```

这是一个尾递归的实现，我们将中间结果`a`和`b`作为参数传递给下一次递归调用，这样就不需要存储中间结果，从而避免栈溢出。


## Tail Recursion in Type

::: tip
以下内容适用于 TypeScript 4.5 及以上语言版本。
:::


同样的，TypeScript类型中也存在递归的场景，当我们使用递归类型时，也可能会遇到栈溢出的问题。

`GetChar<S>`是一个获取`S`中每个字符的联合类型的类型。

考虑下面`GetChar`的实现：

```ts
type GetChars<S> =
    S extends `${infer Char}${infer Rest}` 
      ? Char | GetChars<Rest> 
      : never;
```

对于`S`, 我们递归地获取第一个字符`F`，然后递归地获取剩余的字符`R`，直到`R`为空。

我们将这个过程转写为类似的ts代码：

```ts
function GetChar<S extends string>(s: S): string {
  if (s.length === 0) return '';
  // or is not valid in TS, just for illustration
  return s[0] or GetChar(s.slice(1)); 
}
```

可以看到，这不符合尾递归的形式，因为尾递归要求递归调用是函数的最后一个操作。

我们改写`GetChar`为尾递归的形式，添加一个额外的参数`Acc`来存储结果。

```ts
type GetChars<S> = GetCharsHelper<S, never>;
type GetCharsHelper<S, Acc> =
    S extends `${infer Char}${infer Rest}` 
      ? GetCharsHelper<Rest, Char | Acc> 
      : Acc;
```

将其转写为类似的ts代码：

```ts
function GetChar<S extends string>(s: S): string {
  return GetCharHelper(s, '');
}

function GetCharHelper<S extends string>(s: S, acc: StringUnion): string {
  if (s.length === 0) return acc;
  // or and StringUnion is not valid in TS, just for illustration
  return GetCharHelper(s.slice(1), acc or s[0]);
}
```

可以看见，我们将中间结果`acc`作为参数传递给下一次递归调用，使得递归调用是函数的最后一个操作，构成了成为尾递归的条件。

::: warning
这里只是构造出了一个符合尾递归的形式，实际上还是递归的代码。

部分编译器以及TypeScript 4.5+开始支持尾递归优化，将递归调用优化为迭代形式.
:::

TypeScript将会自动将递归类型在计算时转换为迭代形式，从而避免栈溢出的问题。

### Additional

`trampoline` 是一个用于实现尾递归优化的技术，它将递归调用转换为迭代形式。

```ts
type Trampoline<T> = T extends (...args: any[]) => infer R ? (...args: any[]) => R : never;

function trampoline<T extends (...args: any[]) => any>(fn: T): Trampoline<T> {
  return (...args: any[]) => {
    let result = fn(...args);
    while (typeof result === 'function') {
      result = result();
    }
    return result;
  };
}
```

我们可以使用`trampoline`函数来实现尾递归优化。

```ts
function fib(n: number, a = 0, b = 1): number {
  if (n === 0) return a;
  return () => fib(n - 1, b, a + b);
}

const trampolineFib = trampoline(fib);

console.log(trampolineFib(10000)); 
```

这样也可以可以避免栈溢出的问题。

#### Trampoline in Type

从`trampline`中获取启发，我们可以尝试在类型中实现类似的功能。

```ts
interface Defer<T> {
  next: T;
  result: unknown;
}

interface Result<T> extends Defer<Result<T>> {
  result: T;
}

type Range<L extends number, H extends number, Idx extends 1[] = L extends 0 ? [] : [1,1], Res = never> = Defer<
  Idx['length'] extends H
  ? Result<H | Res>
  : Range<L, H, [...Idx, 1], Idx['length'] | Res>
>

type For<T> = T[Extract<'next', keyof T>]

type GetNext_5Times<T> = 
    For<T> extends infer T
  ? For<T> extends infer T
  ? For<T> extends infer T
  ? For<T> extends infer T
  ? For<T>
  : never
  : never
  : never
  : never

type GetNext_50Times<T> = 
    GetNext_5Times<T> extends infer T
  ? GetNext_5Times<T> extends infer T
  ? GetNext_5Times<T> extends infer T
  ? GetNext_5Times<T> extends infer T
  ? GetNext_5Times<T> extends infer T
  ? GetNext_5Times<T> extends infer T
  ? GetNext_5Times<T> extends infer T
  ? GetNext_5Times<T> extends infer T
  ? GetNext_5Times<T> extends infer T
  ? GetNext_5Times<T>
  : never
  : never
  : never
  : never
  : never
  : never
  : never
  : never
  : never

type GetNext_200Times<T> = 
    GetNext_50Times<T> extends infer T
  ? GetNext_50Times<T> extends infer T
  ? GetNext_50Times<T> extends infer T
  ? GetNext_50Times<T>
  : never
  : never
  : never

type NumberRange<L extends number, R extends number> = GetNext_200Times<Range<L, R>>['result']

type test = NumberRange<0, 140>
```
> ref: https://github.com/type-challenges/type-challenges/issues/9084


解释： 
`defer`延迟了下一步的计算。这有助于通过在需要时才评估下一步来管理递归深度。

`Result`通过持有结果来表示递归链的结束. `Result<T>`的`next`还是`Result<T>`，但`result`是`T`。这样的设计能保证多余的`next`被求值时返回正确的类型。

`Range`是一个递归类型，它会递归地生成一个范围从`L`到`H`的数字类型。

`GetNext_5Times` `GetNext_50Times` `GetNext_200Times`

这些类型将递归步骤分解为可管理的块（5次、50次、200次）。

这防止了任何单次类型评估变得过深，从而触及递归限制。


通过将递归分解为更小的、可管理的部分，并使用 Defer 类型延迟计算，代码避免了触及 TypeScript 的递归类型限制。计算的每一步仅需要较小的递归深度，而较大的问题是通过组合这些较小的递归步骤来解决的。


### Reference

ref: https://www.typescriptlang.org/docs/handbook/release-notes/typescript-4-5.html#tail-recursion-elimination-on-conditional-types
