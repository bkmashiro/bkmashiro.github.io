---
date: 2026-03-31
description: TypeChallenge - 4499 Chunk
title: Chunk
readingTime: true
tag:
  - TypeScript
  - TypeChallenge
  - TC-Medium
outline: [2, 3]
article: false
---

# Chunk

[题目链接](https://tsch.js.org/4499)

## 题目

你知道 `lodash` 吗？`Chunk` 是其中一个非常实用的函数，现在让俺们用类型来实现它。

`Chunk<T, N>` 接受两个必填类型参数：`T` 必须是一个元组，`N` 必须是一个大于等于 1 的整数。

```ts
type exp1 = Chunk<[1, 2, 3], 2>    // [[1, 2], [3]]
type exp2 = Chunk<[1, 2, 3], 4>    // [[1, 2, 3]]
type exp3 = Chunk<[], 0>            // []
```

## 解答

### 思路：累积当前分块

核心思路：用一个 `Current` 累加器元组收集当前块。当它装满 `N` 个元素时，将其「刷入」结果，然后开启新块。

```ts
type Chunk<
  T extends unknown[],
  N extends number,
  Current extends unknown[] = []
> = T extends [infer Head, ...infer Tail]
  ? Current['length'] extends N
    ? [Current, ...Chunk<T, N>]
    : Chunk<Tail, N, [...Current, Head]>
  : Current extends []
    ? []
    : [Current]
```

### 逐步分析

1. 从 `T` 中取出 `Head`
2. 若 `Current` 已有 `N` 个元素 → 将 `Current` 刷入结果，**用完整的 `T`（包含 `Head`）重新开始**
3. 否则 → 将 `Head` 加入 `Current`，继续递归处理 `Tail`
4. `T` 耗尽时：若 `Current` 非空，将其作为最后一块输出；否则输出 `[]`

### 测试用例追踪

以 `Chunk<[1, 2, 3], 2>` 为例：

```
Chunk<[1,2,3], 2, []>
  → Current.length=0, not 2, add Head=1
Chunk<[2,3], 2, [1]>
  → Current.length=1, not 2, add Head=2
Chunk<[3], 2, [1,2]>
  → Current.length=2 = N! flush [1,2], restart with T=[3]
  → [[1,2], ...Chunk<[3], 2, []>]
Chunk<[3], 2, []>
  → add Head=3
Chunk<[], 2, [3]>
  → T 耗尽，Current=[3] 非空
  → [[3]]
最终：[[1,2], [3]] ✓
```

## 深入分析

### 关键：刷新时用原始 `T` 重新开始

刷新块时，俺们传入的是 **完整的 `T`**（而不是 `Tail`）：

```ts
? [Current, ...Chunk<T, N>]   // ✅ 用 T，包含当前 Head
//          ^
//          传入 T，不是 Tail
```

如果传入 `Tail`，`Head` 就会被丢失。这是此解法中最容易出错的地方。

### 空元组的判断

```ts
: Current extends []
    ? []
    : [Current]
```

用 `Current extends []` 检测空元组（字面量匹配），而不是 `Current['length'] extends 0`。两者都能工作，但 `extends []` 语义更清晰。

### 元组长度作为计数器

TypeScript 元组的 `['length']` 是一个数字字面量类型。这正是俺们如何在类型层面「计数」的方式：

```ts
type T = [1, 2, 3]
type Len = T['length']  // 3（字面量类型，不是宽泛的 number）
```

通过将 `Current['length']` 与 `N` 进行比较，俺们完全在类型系统内实现了「块大小检查」。

### 与 JavaScript 运行时行为的对比

对应的 JavaScript 实现：

```ts
function chunk<T>(arr: T[], n: number): T[][] {
  const result: T[][] = []
  for (let i = 0; i < arr.length; i += n) {
    result.push(arr.slice(i, i + n))
  }
  return result
}
```

类型层面的递归方式与命令式循环 + slice 等价，只是通过结构递归来实现「前进」。

### 边界情况

- `N >= T['length']`：整个元组作为单块输出 → `[[...T]]`
- `T = []`：直接返回 `[]`（`T extends [infer Head, ...]` 匹配失败，`Current=[]`）
- `N = 1`：每个元素单独一块 → `[[1], [2], [3], ...]`

## 要点总结

1. **「刷新则重新开始」模式** —— 检测块满时，用完整的 `T`（含当前 `Head`）重启，而非 `Tail`，这是避免丢失元素的关键
2. **`['length']` 作为计数器** —— TypeScript 元组长度是字面量类型，可直接用于 `extends` 比较，是类型层面计数的标准方法
3. **空元组检测** —— `Current extends []` 语义清晰地区分了「块为空」和「块非空」的收尾逻辑
4. **三态递归结构** —— 该解法呈现了一种经典的「填充 → 刷新 → 收尾」三阶段递归模板，可复用于类似分组/分批问题
5. **类型参数默认值** —— `Current extends unknown[] = []` 使递归状态对调用方透明，外部调用只需传 `T` 和 `N`
