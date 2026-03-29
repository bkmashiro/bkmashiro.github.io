---
date: 2026-03-29
description: TypeChallenge - 0189 - Easy - Awaited
title: "0189 · Awaited"
readingTime: true
tag:
  - TypeScript
  - TypeChallenge
  - TC-Easy
outline: [2, 3]
article: false
---

# 0189 · Awaited

[Challenge Link](https://tsch.js.org/189)

## Problem

Implement a generic `MyAwaited<T>` that recursively unwraps the value inside a `Promise`.

```ts
type Example1 = MyAwaited<Promise<string>> // string
type Example2 = MyAwaited<Promise<Promise<number>>> // number
```

## Solution

```ts
type MyAwaited<T extends PromiseLike<any>> = T extends PromiseLike<infer U>
  ? U extends PromiseLike<any>
    ? MyAwaited<U>
    : U
  : never
```

## Explanation

The core idea is to repeatedly extract the resolved value type until the result is no longer promise-like.

### Step by Step

1. `T extends PromiseLike<any>` ensures the input is promise-like.
2. `T extends PromiseLike<infer U>` extracts the value inside the promise.
3. If `U` is still `PromiseLike<any>`, recurse with `MyAwaited<U>`.
4. Otherwise, return `U`.

### Why `PromiseLike`?

`PromiseLike<T>` is more general than `Promise<T>`. It matches standard promises and thenable-style objects, which is exactly what the challenge expects.

### Example Walkthrough

```ts
type Result = MyAwaited<Promise<Promise<number>>>
```

This expands as:

```ts
MyAwaited<Promise<Promise<number>>>
-> MyAwaited<Promise<number>>
-> number
```

## Alternative Solutions

### Option 1: Single-Branch Recursive Form

```ts
type MyAwaited2<T extends PromiseLike<any>> = T extends PromiseLike<infer U>
  ? U extends PromiseLike<any>
    ? MyAwaited2<U>
    : U
  : never
```

This is effectively the same logic with a different name. It is explicit and easy to read.

### Option 2: Recursive Unwrap Helper

```ts
type UnwrapPromise<T> = T extends PromiseLike<infer U> ? UnwrapPromise<U> : T
type MyAwaited3<T extends PromiseLike<any>> = UnwrapPromise<T>
```

This separates "recursive unwrapping" from the public challenge type. It is useful when the same unwrapping logic will be reused elsewhere.

## Thought Process

The challenge looks simple if we only consider `Promise<number>`, but the recursive case is the real point. A one-level unwrap is not enough because `Promise<Promise<T>>` should still produce `T`.

That naturally leads to a conditional type plus `infer`:

- Use `infer` to grab the resolved value.
- Check whether that value is still promise-like.
- Keep unwrapping until it is not.

**Key concepts:**
- [Conditional Types](https://www.typescriptlang.org/docs/handbook/2/conditional-types.html)
- [Inferring Within Conditional Types](https://www.typescriptlang.org/docs/handbook/2/conditional-types.html#inferring-within-conditional-types)
- [`PromiseLike`](https://www.typescriptlang.org/docs/handbook/utility-types.html)

## 中文解析

### 解题思路

```ts
// T extends PromiseLike<any>：约束入参必须是类 Promise 对象
// T extends PromiseLike<infer U>：用 infer 推导出 Promise 内部的类型 U
// 若 U 仍是 PromiseLike，则递归拆包；否则 U 就是最终结果
type MyAwaited<T extends PromiseLike<any>> =
  T extends PromiseLike<infer U>   // 第一层：提取 Promise 内部类型 U
    ? U extends PromiseLike<any>   // 第二层：U 是否还是 Promise？
      ? MyAwaited<U>               //   是 → 递归继续拆包
      : U                          //   否 → U 就是最终值类型
    : never                        // 理论上不可达（T 已被约束为 PromiseLike）
```

### 逐步分析

**第一步：用 `infer` 提取 Promise 内部类型**

`infer` 关键字用于在条件类型的 `extends` 子句中声明一个待推导的类型变量：

```ts
type Unwrap<T> = T extends Promise<infer U> ? U : never
// Unwrap<Promise<string>> → string
// Unwrap<Promise<number>> → number
// Unwrap<string>          → never（不匹配则走 false 分支）
```

**第二步：处理嵌套 Promise（递归的必要性）**

一次 `infer` 只能剥开一层，但题目要求深度拆包：

```ts
// 单层 unwrap 不够：
type BadAwaited<T> = T extends Promise<infer U> ? U : never
// BadAwaited<Promise<Promise<number>>>
// → Promise<number>（只剥了一层，还是 Promise）

// 正确做法：检查 U 是否还是 Promise，是则递归
type MyAwaited<T extends PromiseLike<any>> =
  T extends PromiseLike<infer U>
    ? U extends PromiseLike<any> ? MyAwaited<U> : U
    : never
// MyAwaited<Promise<Promise<number>>>
// → MyAwaited<Promise<number>>  （U = Promise<number>，继续递归）
// → number                       （U = number，不是 PromiseLike，返回）
```

**第三步：为什么用 `PromiseLike` 而非 `Promise`**

`PromiseLike<T>` 是只有 `.then()` 方法的最小接口，而 `Promise<T>` 还要求 `.catch()`、`.finally()` 等方法。题目测试用例包含自定义的 thenable 对象，因此使用更宽泛的 `PromiseLike` 能正确处理这些边缘情况：

```ts
// PromiseLike 的接口定义（TypeScript 标准库中）：
interface PromiseLike<T> {
  then<TResult1 = T, TResult2 = never>(
    onfulfilled?: ...,
    onrejected?: ...
  ): PromiseLike<TResult1 | TResult2>
}
// 任何有 .then() 方法的对象都满足 PromiseLike
```

### 考察知识点

1. **`infer` 关键字**：在条件类型的 `extends` 子句中声明待推导类型变量，是实现类型"解构"的核心工具。理解 `infer` 是解题的关键，它让我们在类型层面"打开"泛型容器，取出内部类型。

2. **递归条件类型（Recursive Conditional Types）**：TypeScript 4.1+ 支持类型别名的递归定义。对于需要深度遍历的类型结构（嵌套 Promise、嵌套数组等），递归条件类型是标准解法。

3. **`PromiseLike` vs `Promise` 的区别**：`PromiseLike` 是结构化类型（structural typing）的最小接口，比 `Promise` 更宽泛，能匹配所有 thenable 对象。在处理异步类型时优先考虑 `PromiseLike` 可以提升类型的兼容性。

4. **条件类型的 false 分支**：本题中 `? MyAwaited<U> : U : never` 的最外层 `never` 理论上不可达（因为 `T` 已被约束为 `PromiseLike`），但 TypeScript 要求条件类型必须有完整的两个分支，`never` 在此作为占位符，同时也是语义上合理的选择（"不可能到达的类型"）。
