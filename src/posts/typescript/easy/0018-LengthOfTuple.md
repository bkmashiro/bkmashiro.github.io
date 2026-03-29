---
date: 2024-08-18
description: TypeChallenge - 0018 - Easy - Length of Tuple
title: "0018 · Length of Tuple"
readingTime: true
tag:
  - TypeScript
  - TypeChallenge
  - TC-Easy
outline: [2, 3]
article: false
---

# 0018 · Length of Tuple

[Challenge Link](https://tsch.js.org/18)

## Problem

For given a tuple, create a generic `Length` that picks the length of the tuple.

```ts
type tesla = ['tesla', 'model 3', 'model X', 'model Y']
type spaceX = ['FALCON 9', 'FALCON HEAVY', 'DRAGON', 'STARSHIP', 'HUMAN SPACEFLIGHT', 'RAPTOR']

type teslaLength = Length<tesla> // expected 4
type spaceXLength = Length<spaceX> // expected 6
```

## Solution

```ts
type Length<T extends readonly any[]> = T["length"]
```

## Explanation

In TypeScript, tuples and arrays have a `length` property accessible via indexed access types.

### Why `T["length"]` Works

For a fixed-length tuple like `['a', 'b', 'c']`, TypeScript tracks the exact length as a literal numeric type:

```ts
type T = ['a', 'b', 'c']
type L = T["length"]  // 3 (literal type, not just number)
```

This is different from regular arrays where `T["length"]` would be `number` (could be any number). For tuples, TypeScript knows the exact length at compile time.

### Why `readonly any[]`?

The constraint `T extends readonly any[]` accepts both:
- Regular mutable arrays: `string[]`, `any[]`
- Readonly tuples and arrays: `readonly string[]`, `readonly [1, 2, 3]`

Without `readonly`, you couldn't pass a `const` tuple (which TypeScript infers as `readonly`):

```ts
const t = ['a', 'b', 'c'] as const
// typeof t = readonly ["a", "b", "c"]
type L = Length<typeof t>  // works because of readonly constraint
```

### Array vs Tuple

| Type | `length` type |
|------|--------------|
| `string[]` | `number` |
| `['a', 'b', 'c']` | `3` |
| `readonly ['x', 'y']` | `2` |

**Step by step:**
1. `T extends readonly any[]` — constrains `T` to be a tuple or array
2. `T["length"]` — indexed access type that retrieves the `length` property type
3. For tuples, this returns the exact literal number; for arrays, it returns `number`

**Key concepts:**
- [Indexed Access Types](https://www.typescriptlang.org/docs/handbook/2/indexed-access-types.html) — `T["key"]` to look up a property type
- `readonly` modifier — enables the type to work with `as const` tuples

## 中文解析

### 解题思路

```ts
// 约束 T 必须是只读数组（元组也满足此约束）
// T["length"] 通过索引访问类型读取 length 属性的类型
type Length<T extends readonly any[]> = T["length"]
//                                         ^^^^^^^^
//                    对于元组，这里会返回字面量数字类型（如 3）
//                    对于普通数组，这里返回 number 类型
```

### 逐步分析

**第一步：理解约束 `T extends readonly any[]`**

这个约束同时接受两类类型：
- 可变数组：`string[]`、`number[]`
- 只读数组/元组：`readonly string[]`、`readonly ['a', 'b', 'c']`

若不加 `readonly`，使用 `as const` 断言的常量元组无法传入，因为 TypeScript 会将其推断为 `readonly` 类型。

**第二步：理解 `T["length"]` 的行为差异**

| 类型 | `T["length"]` 的结果 |
|------|---------------------|
| `string[]` | `number`（可以是任意数量）|
| `['a', 'b', 'c']` | `3`（字面量类型）|
| `readonly ['x', 'y']` | `2`（字面量类型）|

关键点：TypeScript 在编译时就能**精确知道**元组的长度，因此 `T["length"]` 对元组返回的是字面量数字类型而非宽泛的 `number`。

**第三步：验证**

```ts
type tesla = ['tesla', 'model 3', 'model X', 'model Y']
type L = Length<tesla>
// → 4（字面量类型，而非 number）

const arr = ['a', 'b'] as const
type L2 = Length<typeof arr>
// → 2（因为 typeof arr = readonly ["a", "b"]）
```

### 考察知识点

1. **索引访问类型（Indexed Access Types）**：`T["key"]` 不仅能访问值类型，也能访问特殊属性如 `length`。这是 TypeScript 类型系统中类比 JS 属性访问的静态操作。

2. **元组 vs 数组的类型精度**：元组是有固定长度和固定成员类型的数组，TypeScript 对其有更精确的类型推断。元组的 `length` 是字面量数字类型，这是实现本题的核心依据。

3. **`readonly` 的必要性**：TypeScript 中 `readonly T[]` 和 `T[]` 是不同的类型，`readonly` 是更宽泛的父类型。加上 `readonly` 约束使得类型参数对两者均兼容，避免了传入 `as const` 元组时的类型错误。
