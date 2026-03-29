---
date: 2026-03-29
description: TypeChallenge - 0459 - Easy - Flatten
title: "0459 · Flatten"
readingTime: true
tag:
  - TypeScript
  - TypeChallenge
  - TC-Easy
outline: [2, 3]
article: false
---

# 0459 · Flatten

[Challenge Link](https://tsch.js.org/459)

## Problem

Implement a type `Flatten<T>` that takes a nested array or tuple type and produces a flattened version.

```ts
type A = Flatten<[1, 2, [3, 4], [[[5]]]]>
// [1, 2, 3, 4, 5]
```

This challenge is about recursively walking through a tuple, checking each element, and expanding nested arrays into the final result.

## Solution

```ts
type Flatten<T extends readonly unknown[]> = T extends readonly [
  infer First,
  ...infer Rest,
]
  ? First extends readonly unknown[]
    ? [...Flatten<First>, ...Flatten<Rest>]
    : [First, ...Flatten<Rest>]
  : []
```

## Explanation

The core idea is:

- split the tuple into a head and tail
- inspect the head
- if the head is itself an array, flatten it recursively
- otherwise keep it and continue with the tail

### Step by Step

1. `T extends readonly unknown[]` constrains the input to arrays and tuples, including readonly tuples.
2. `T extends readonly [infer First, ...infer Rest]` destructures the tuple into its first element and the remaining elements.
3. If `First extends readonly unknown[]`, then `First` is another nested array, so flatten it and spread the result.
4. Otherwise, keep `First` as a single element.
5. Recurse on `Rest`.
6. When `T` is empty, return `[]`.

### Why Use `readonly unknown[]`?

Many type-challenge test cases use readonly tuples inferred from `as const`.

```ts
const data = [1, [2, 3]] as const
```

The type of `data` is readonly, so `Flatten<T extends readonly unknown[]>` is more flexible than `Flatten<T extends unknown[]>`.

The `readonly` marker also needs to appear in the tuple pattern. Otherwise a readonly tuple may fail to match the recursive branch.

### Example Walkthrough

Start with:

```ts
type Result = Flatten<[1, [2, [3]], 4]>
```

The recursion unfolds like this:

```ts
Flatten<[1, [2, [3]], 4]>
-> [1, ...Flatten<[[2, [3]], 4]>]
-> [1, ...Flatten<[2, [3]]>, ...Flatten<[4]>]
-> [1, 2, ...Flatten<[[3]]>, 4]
-> [1, 2, ...Flatten<[3]>, 4]
-> [1, 2, 3, 4]
```

Each nested array is flattened before being merged back into the surrounding result.

## Alternative Solutions

### Option 1: Accumulator Style

```ts
type Flatten2<
  T extends readonly unknown[],
  Acc extends readonly unknown[] = [],
> = T extends readonly [infer First, ...infer Rest]
  ? First extends readonly unknown[]
    ? Flatten2<Rest, [...Acc, ...Flatten2<First>]>
    : Flatten2<Rest, [...Acc, First]>
  : Acc
```

This version collects the result in `Acc`. It can be useful if you prefer an explicit "build the answer as you go" style.

### Option 2: Mutable Array Constraint

```ts
type Flatten3<T extends unknown[]> = T extends [infer First, ...infer Rest]
  ? First extends unknown[]
    ? [...Flatten3<First>, ...Flatten3<Rest>]
    : [First, ...Flatten3<Rest>]
  : []
```

This is shorter, but it is less compatible because it does not accept readonly tuples.

## Thought Process

A flatten operation is naturally recursive:

- a flat value contributes one element
- a nested array contributes all of its flattened elements

That maps directly onto tuple recursion with `[infer First, ...infer Rest]`.

The important insight is that we are solving two problems at the same time:

1. walking across the top-level tuple
2. diving into nested tuples when an element is itself an array

The spread syntax in the result lets both parts compose nicely.

## Key Takeaways

- Tuple recursion is a powerful way to process arrays at the type level.
- `infer First` and `infer Rest` let us model head-tail recursion.
- Spread syntax like `[...A, ...B]` is what makes flattening ergonomic in TypeScript.

**Key concepts:**
- [Variadic Tuple Types](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-4-0.html#variadic-tuple-types)
- [Conditional Types](https://www.typescriptlang.org/docs/handbook/2/conditional-types.html)
- Recursive tuple processing

## 中文解析

### 类型定义解读

```ts
type Flatten<T extends readonly unknown[]> =
  T extends readonly [infer First, ...infer Rest]  // 拆出头元素 First 与剩余 Rest
    ? First extends readonly unknown[]             // 判断 First 是否还是数组/元组
      ? [...Flatten<First>, ...Flatten<Rest>]      // 是数组 → 递归展平 First，再接上展平后的 Rest
      : [First, ...Flatten<Rest>]                  // 不是数组 → 保留 First，继续处理 Rest
    : []                                           // T 为空元组 → 返回 []
```

### 逐步分析

**整体思路：头尾递归 + 双重展开**

对于每个元素：
1. 如果它是数组 → 先展平它（递归），再把结果拼进去
2. 如果它不是数组 → 直接保留，继续处理剩余

两个子问题在展开时自然合并：`[...flatFirst, ...flatRest]`

**递归展开示例**

```
Flatten<[1, [2, [3]], 4]>

步骤1: First=1, Rest=[[2,[3]], 4]
  1 不是数组 → [1, ...Flatten<[[2,[3]], 4]>]

步骤2: First=[2,[3]], Rest=[4]
  [2,[3]] 是数组 → [...Flatten<[2,[3]]>, ...Flatten<[4]>]

步骤3: Flatten<[2,[3]]>
  First=2, Rest=[[3]]
  2 不是数组 → [2, ...Flatten<[[3]]>]
  First=[3], Rest=[]
  [3] 是数组 → [...Flatten<[3]>, ...Flatten<[]>]
  = [...[3], ...[]] = [3]
  → [2, 3]

步骤4: Flatten<[4]> = [4]

最终: [1, 2, 3, 4] ✅
```

**为什么两处都要写 `readonly`？**

- 约束 `T extends readonly unknown[]`：接受 readonly 输入
- 条件模式 `T extends readonly [infer First, ...infer Rest]`：只读元组才能匹配只读模式

如果只在约束处写 `readonly`，但条件分支里的模式不带 `readonly`，那么 `readonly [1, 2]` 就无法匹配该分支，导致直接返回 `[]`。

### 考察知识点

- **双层递归**：同时在"横向"（遍历元组）和"纵向"（深入嵌套层）进行递归，两个维度在展开时自然合并
- **`infer` 与头尾分解**：`[infer First, ...infer Rest]` 是处理元组的核心模式，相当于 Haskell 的 `x:xs`
- **嵌套类型判断**：`First extends readonly unknown[]` 用于区分"普通值"和"还需继续展平的数组"
- **展开语法合并**：`[...A, ...B]` 让递归结果的拼接变得直观，避免了手写 Concat 的繁琐
- **`readonly` 的传递性**：在操作只读元组时，条件分支的模式也需要对应加 `readonly`，否则匹配失败
