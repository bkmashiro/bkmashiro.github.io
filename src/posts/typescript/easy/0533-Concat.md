---
date: 2026-03-29
description: TypeChallenge - 0533 - Easy - Concat
title: "0533 · Concat"
readingTime: true
tag:
  - TypeScript
  - TypeChallenge
  - TC-Easy
outline: [2, 3]
article: false
---

# 0533 · Concat

[Challenge Link](https://tsch.js.org/533)

## Problem

Implement a type `Concat<T, U>` that combines two tuple or array types into one.

```ts
type Result = Concat<[1], [2]> // [1, 2]
```

## Solution

```ts
type Concat<T extends readonly unknown[], U extends readonly unknown[]> = [...T, ...U]
```

## Explanation

This challenge is a direct use of tuple spread syntax at the type level.

### Step by Step

1. `T extends readonly unknown[]` constrains the first input to an array or tuple.
2. `U extends readonly unknown[]` does the same for the second input.
3. `[...T, ...U]` creates a new tuple type by spreading both inputs in order.

### Why `readonly unknown[]`?

The challenge tests often use readonly tuples inferred from `as const`.

```ts
const a = [1, 2] as const
// typeof a = readonly [1, 2]
```

If we used `T extends unknown[]`, readonly tuples would not match. Using `readonly unknown[]` makes the type work for both mutable arrays and readonly tuples.

### Example Walkthrough

```ts
type A = Concat<[1, 2], ['a', 'b']> // [1, 2, 'a', 'b']
```

TypeScript preserves the order and literal element types from both tuples.

## Alternative Solutions

### Option 1: Mutable Array Constraint

```ts
type Concat2<T extends any[], U extends any[]> = [...T, ...U]
```

This works for many simple cases, but it is weaker because it does not accept readonly tuples.

### Option 2: Variadic Tuple Helper

```ts
type MergeTuples<A extends readonly unknown[], B extends readonly unknown[]> = [...A, ...B]
type Concat3<T extends readonly unknown[], U extends readonly unknown[]> = MergeTuples<T, U>
```

This does the same thing, but extracts the tuple merge into a reusable helper.

## Thought Process

Older tuple-manipulation problems often require recursive inference, so it is tempting to overcomplicate this one. But `Concat` is much simpler: TypeScript already supports variadic tuple types, and tuple spread does exactly what we need.

The main subtlety is not the implementation itself. It is choosing constraints that also accept readonly tuples.

**Key concepts:**
- [Variadic Tuple Types](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-4-0.html#variadic-tuple-types)
- [Tuple Types](https://www.typescriptlang.org/docs/handbook/2/objects.html#tuple-types)

## 中文解析

### 类型定义解读

```ts
type Concat<
  T extends readonly unknown[],  // 约束为只读数组/元组（兼容 as const 推断结果）
  U extends readonly unknown[]   // 同上
> = [...T, ...U]                 // 直接展开两个元组，合并为新元组类型
```

### 逐步分析

**这道题的核心就是一行：元组展开语法**

TypeScript 4.0 引入了 Variadic Tuple Types（可变参数元组类型），让我们可以在类型层面使用展开运算符：

```ts
type A = [1, 2]
type B = ['a', 'b']
type C = [...A, ...B]  // [1, 2, 'a', 'b'] — 字面量类型被保留！
```

**为什么约束用 `readonly unknown[]` 而不是 `unknown[]`？**

`as const` 会推断出 readonly 元组：
```ts
const arr = [1, 2] as const
// typeof arr = readonly [1, 2]  ← 注意 readonly
```

如果约束写 `T extends unknown[]`，则 `readonly [1, 2]` 不满足（只读不能赋给可变），类型报错。
用 `readonly unknown[]` 则同时兼容 `[1, 2]` 和 `readonly [1, 2]`。

**字面量类型的保留**

展开操作不仅合并元组，还保留每个元素的字面量类型和位置信息：

```ts
type R = Concat<[1, 2], ['a', 'b']>
// 结果：[1, 2, 'a', 'b']  — 不是 (number | string)[]
```

### 考察知识点

- **Variadic Tuple Types（可变参数元组）**：TypeScript 4.0 的重要特性，`[...T, ...U]` 在类型层面等价于运行时的数组展开
- **`readonly` 约束兼容性**：`readonly unknown[]` 是接受所有数组/元组（包括 `as const` 推断结果）的最宽泛约束
- **元组 vs 数组类型**：`[1, 2]` 是长度固定、元素类型各自确定的元组；`number[]` 是长度不定的数组。展开语法能保留元组的精确类型信息
- **解题思维**：不要被"元组操作"的标签吓到而想复杂化——先看 TypeScript 内置语法能不能直接解决
