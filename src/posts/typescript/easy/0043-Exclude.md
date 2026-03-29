---
date: 2024-08-18
description: TypeChallenge - 0043 - Easy - Exclude
title: "0043 · Exclude"
readingTime: true
tag:
  - TypeScript
  - TypeChallenge
  - TC-Easy
outline: [2, 3]
article: false
---

# 0043 · Exclude

[Challenge Link](https://tsch.js.org/43)

## Problem

Implement the built-in `Exclude<T, U>` generic without using it.

> Exclude from `T` those types that are assignable to `U`.

```ts
type Result = MyExclude<'a' | 'b' | 'c', 'a'>
// expected: 'b' | 'c'
```

## Solution

```ts
type MyExclude<T, U> = T extends U ? never : T
```

## Explanation

This is a one-liner that leverages one of TypeScript's most powerful features: **distributive conditional types**.

### Distributive Conditional Types

When you write `T extends U ? A : B` and `T` is a **naked type parameter** (i.e., not wrapped in `[]`, `{}`, etc.), TypeScript automatically **distributes** the conditional over each member of a union type:

```ts
type MyExclude<T, U> = T extends U ? never : T

// With T = 'a' | 'b' | 'c' and U = 'a':
// Distributes to:
//   ('a' extends 'a' ? never : 'a')   → never
// | ('b' extends 'a' ? never : 'b')   → 'b'
// | ('c' extends 'a' ? never : 'c')   → 'c'
// Result: never | 'b' | 'c' → 'b' | 'c'
```

### Why `never` is the Right "Remove" Signal

`never` is TypeScript's bottom type — it represents an impossible value. In a union, `never` is automatically eliminated:

```ts
type T = never | 'b' | 'c'  // simplifies to 'b' | 'c'
```

So using `never` in the true branch of the conditional effectively removes that member from the union.

### Step by Step

1. `T extends U ? never : T` — for each member of `T`:
   - If the member is assignable to `U` → replace it with `never` (remove it)
   - Otherwise → keep it as is
2. The resulting union has all `never`s filtered out automatically
3. What remains is the original `T` minus anything in `U`

### Non-Distributive Comparison

If `T` were wrapped (e.g., `[T] extends [U]`), distribution would not happen:

```ts
type NonDistributive<T, U> = [T] extends [U] ? never : T
// NonDistributive<'a' | 'b' | 'c', 'a'>
// → ['a' | 'b' | 'c'] extends ['a'] ? never : 'a' | 'b' | 'c'
// → 'a' | 'b' | 'c'  (the whole union doesn't extend ['a'])
```

This is why the naked type parameter `T` (no wrapping) is essential for `Exclude` to work correctly.

**Key concepts:**
- [Distributive Conditional Types](https://www.typescriptlang.org/docs/handbook/2/conditional-types.html#distributive-conditional-types) — how TypeScript distributes over union members
- `never` in unions — always simplified away, acting as the identity element for union types

## 中文解析

### 解题思路

```ts
// 分配式条件类型：当 T 是裸类型参数时，条件类型会对联合类型的每个成员分别求值
// T extends U → 该成员可赋值给 U → 用 never 替换（即"删除"）
// T extends U → 不可赋值 → 保留 T 本身
type MyExclude<T, U> = T extends U ? never : T
//                     ^^^^^^^^^^^^^^^^^^^^^^^^^^
//                     关键：T 是裸类型参数，触发分配律
```

### 逐步分析

**第一步：什么是分配式条件类型（Distributive Conditional Types）**

当条件类型中的被检查类型是"裸类型参数"（naked type parameter，即没有被 `[]`、`{}`、`Readonly<>` 等包裹），TypeScript 会自动对联合类型的每个成员分别应用条件：

```ts
// T = 'a' | 'b' | 'c', U = 'a'
// 展开为：
//   ('a' extends 'a' ? never : 'a')  →  never
// | ('b' extends 'a' ? never : 'b')  →  'b'
// | ('c' extends 'a' ? never : 'c')  →  'c'
// 合并结果：never | 'b' | 'c'  →  'b' | 'c'
```

**第二步：为什么用 `never` 表示"删除"**

`never` 是 TypeScript 的底部类型（bottom type），代表不可能存在的值。在联合类型中，`never` 会被自动消除：

```ts
type T = never | 'b' | 'c'
// 等价于 'b' | 'c'
// never 是联合类型的单位元（identity element）
```

因此，将"要排除的成员"替换为 `never`，TypeScript 在合并联合时会自动丢弃它，达到过滤效果。

**第三步：裸类型参数 vs 包裹类型参数的对比**

```ts
// 裸类型参数（触发分配律）✅
type Exclude1<T, U> = T extends U ? never : T

// 包裹类型参数（不触发分配律）❌
type Exclude2<T, U> = [T] extends [U] ? never : T
// Exclude2<'a' | 'b' | 'c', 'a'>
// → ['a' | 'b' | 'c'] extends ['a'] ? never : 'a' | 'b' | 'c'
// → 整体不满足，返回 'a' | 'b' | 'c'（什么都没排除）
```

包裹后失去分配性，整个联合类型作为一个整体参与比较，导致无法逐一筛选。

### 考察知识点

1. **分配式条件类型（Distributive Conditional Types）**：这是 TypeScript 中实现联合类型过滤/映射的核心机制。当 `T` 是裸类型参数时，`T extends Cond ? A : B` 会自动展开为联合。

2. **`never` 在联合类型中的角色**：`never` 是任何类型的子类型（bottom type），在联合中被消除，相当于集合中的空集。理解这一点是实现各种"过滤"类工具类型的基础。

3. **类型参数的裸性（Nakedness）**：`T` vs `[T]` vs `Array<T>` 在条件类型中行为不同。这个细节在自定义工具类型时非常关键，有时需要刻意包裹来**阻止**分配律（如实现 `IsUnion` 等工具类型时）。

4. **与内置类型的关系**：`Exclude<T, U>` 是 TypeScript 标准库中的内置工具类型，其实现正是本题答案。理解它是理解 `Omit`、`Pick` 等更复杂工具类型的基础。
