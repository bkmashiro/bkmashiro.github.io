---
date: 2026-03-29
description: TypeChallenge - 0898 - Easy - Includes
title: "0898 · Includes"
readingTime: true
tag:
  - TypeScript
  - TypeChallenge
  - TC-Easy
outline: [2, 3]
article: false
---

# 0898 · Includes

[Challenge Link](https://tsch.js.org/898)

## Problem

Implement a type `Includes<T, U>` that checks whether `U` exists in tuple `T`.

```ts
type Result1 = Includes<['a', 'b', 'c'], 'a'> // true
type Result2 = Includes<[1, 2, 3], 4> // false
```

## Solution

```ts
type Equal<X, Y> = (<T>() => T extends X ? 1 : 2) extends
  (<T>() => T extends Y ? 1 : 2)
  ? true
  : false

type Includes<T extends readonly unknown[], U> = T extends [
  infer First,
  ...infer Rest,
]
  ? Equal<First, U> extends true
    ? true
    : Includes<Rest, U>
  : false
```

## Explanation

The tricky part is that this challenge wants strict type equality, not loose assignability.

For example:

```ts
type A = Includes<[{}], {}> // false in the official tests
```

If we only used `U extends T[number]`, this case would be wrong because `{}` is too broad and assignability is not the same as exact equality.

### Step by Step

1. Split the tuple into `First` and `Rest`.
2. Compare `First` and `U` with `Equal`.
3. If they are exactly the same type, return `true`.
4. Otherwise, recursively check the remaining elements.
5. If the tuple becomes empty, return `false`.

### Why `Equal` Is Necessary

`Equal<X, Y>` is a common utility in type challenges. It checks whether two types are exactly the same instead of just being assignable to each other.

That matters for cases like:

```ts
type A = Equal<boolean, false> // false
type B = Equal<true, true> // true
type C = Equal<{}, {}> // true
```

### Example Walkthrough

```ts
type Result = Includes<[1, 2, 3], 2>
```

This expands roughly like:

```ts
Equal<1, 2> -> false
Includes<[2, 3], 2>
Equal<2, 2> -> true
```

So the final result is `true`.

## Alternative Solutions

### Option 1: Naive Union Check

```ts
type Includes2<T extends readonly unknown[], U> = U extends T[number] ? true : false
```

This is short, but not correct for the official tests because it checks assignability, not exact equality.

### Option 2: Helper-Based Recursion

```ts
type Equal2<X, Y> = (<T>() => T extends X ? 1 : 2) extends
  (<T>() => T extends Y ? 1 : 2)
  ? true
  : false

type IncludesHelper<T extends readonly unknown[], U> = T extends [
  infer Head,
  ...infer Tail,
]
  ? Equal2<Head, U> extends true
    ? true
    : IncludesHelper<Tail, U>
  : false
```

This is the same algorithm split into smaller units, which can be easier to reuse in later tuple problems.

## Thought Process

The first instinct is usually "convert the tuple to a union and check membership." That works for value-level intuition, but it fails at the type level because membership here really means exact type equality.

So the correct direction is:

- Iterate through the tuple one item at a time.
- Compare with a strict equality helper.
- Stop early when a match is found.

This pattern shows up frequently in medium challenges too, so `Includes` is a good foundation problem.

**Key concepts:**
- [Conditional Types](https://www.typescriptlang.org/docs/handbook/2/conditional-types.html)
- [Variadic Tuple Types](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-4-0.html#variadic-tuple-types)
- Recursive tuple processing

## 中文解析

### 类型定义解读

```ts
// 严格相等辅助类型：通过"双向条件类型"绕过 TS 的结构类型系统
type Equal<X, Y> =
  (<T>() => T extends X ? 1 : 2) extends  // 构造一个关于 X 的泛型函数类型
  (<T>() => T extends Y ? 1 : 2)          // 再构造一个关于 Y 的泛型函数类型
    ? true                                 // 如果两个函数类型完全一致 → true
    : false

type Includes<T extends readonly unknown[], U> =
  T extends [infer First, ...infer Rest]  // 将元组拆分为「头元素」和「剩余元素」
    ? Equal<First, U> extends true        // 严格比较头元素与目标类型
      ? true                              // 命中 → 直接返回 true
      : Includes<Rest, U>                 // 未命中 → 递归检查剩余部分
    : false                               // 元组为空 → 返回 false
```

### 逐步分析

**为什么不能直接用 `U extends T[number]`？**

`T[number]` 把元组转成联合类型，再用 `extends` 检查的是"可赋值性"而非"严格相等"。例如：
- `{} extends {}` 为 true，但 `Equal<{}, {}>` 也是 true——这里没问题
- `boolean extends true | false` 为 true，但 `Equal<boolean, true>` 为 false——这里就出问题了

官方测试中有 `Includes<[boolean], false>` 期望返回 `false`，用联合检查会错误地返回 `true`。

**`Equal<X, Y>` 的工作原理**

这是利用 TypeScript 内部"延迟类型求值"的技巧：
1. `<T>() => T extends X ? 1 : 2` 是一个泛型函数类型，TypeScript 只有在 `T` 确定时才能求值。
2. 两个这样的函数类型仅在 `X` 和 `Y` 完全相同时才被认为是同一类型。
3. `boolean` 和 `true` 虽然有赋值关系，但它们的延迟条件展开方式不同，所以 `Equal<boolean, true> = false`。

**递归展开示例**

```
Includes<[1, 2, 3], 2>
  → Equal<1, 2> = false → Includes<[2, 3], 2>
  → Equal<2, 2> = true  → true ✅
```

### 考察知识点

- **条件类型（Conditional Types）**：`T extends U ? A : B` 的基本形式
- **`infer` 关键字**：在条件类型中提取子类型，`[infer First, ...infer Rest]` 是元组头尾分解的标准模式
- **分布式条件类型的陷阱**：直接用 `extends` 检查联合类型时会分布展开，导致与预期不符
- **严格类型相等**：`Equal<X, Y>` 利用延迟泛型函数类型实现精确相等判断，是 type-challenges 中的高频工具类型
- **尾递归元组遍历**：将问题分解为"处理头元素 + 递归处理剩余"，是处理元组的通用模式
