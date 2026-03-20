---
title: "typed-pipeline 重构：从 $$ 魔法到最完整版"
date: 2026-03-20
description: "把一个用符号魔法实现的 TypeScript Pipeline 库重构——保留旧版的参数自动推断优点，加入 run(input) 外部 seed、$$-aware 步骤注入、parallel/saveAs，最终融合成一个「全都要」的版本。"
readingTime: true
tag:
  - TypeScript
  - 类型系统
  - 重构
  - 函数式
outline: [2, 3]
---

`typed-pipeline` 是我之前做的一个 TypeScript 管道组合库。重构过程走了一些弯路，最终找到了兼顾所有优点的方案。

- GitHub: [bkmashiro/typed-pipeline](https://github.com/bkmashiro/typed-pipeline)

---

## 旧版：符号魔法

旧版的核心设计是一个叫 `$$` 的 Symbol，表示"上一步的结果"：

```ts
const pipeline = pipe(
  (x: number) => x * 2,
  ($$, y: number) => $$ + y,  // $$ = 前一步结果
)
```

旧版有一个真正的优点：**参数类型自动推断**。`.pipe(n => n * 2)` 里的 `n` 不需要标注类型，TypeScript 从链式上下文自动推断。

但代价也很高：

- `WarpedValue<T>` + `Lazy<T>` 包装类型污染用户代码
- `run()` 没有外部输入——第一步必须是无参函数
- 300+ 行类型工具（`Conditional<GetFlagAndEquals<...>>`），大半是在打补丁

---

## 第一次重构：`Pipeline<In, Out>`

第一版重构目标是"干净"：双泛型、`run(input)`、可读类型。

```ts
const pipeline = new Pipeline<number>()
  .pipe((n) => n * 2)
  .pipe((n) => `value: ${n}`)

await pipeline.run(5)  // "value: 10"
```

但发现丢了旧版的优点——**参数类型不再自动推断**，每个步骤都要写类型标注。

原因是 `pipe(step: Step<TOutput, TNext>)` 是单个签名，TypeScript 对联合类型无法做 contextual typing。

---

## 最终版：融合所有优点

关键发现：用 **overload 把 PlainStep 和 PrevStep 分开**，TypeScript 就能对每个签名分别做 contextual typing。

```ts
// Overload 1: 普通步骤 — 参数类型自动推断
pipe<TNext>(step: PlainStep<TOutput, TNext>): Pipeline<TInput, TNext, TSaved>
// Overload 2: $$-aware 步骤 — $$ 自动推断为上一步输出类型
pipe<TNext>(step: PrevStep<TOutput, TNext>): Pipeline<TInput, TNext, TSaved>
```

最终 API：

```ts
const pipeline = new Pipeline<number>()
  .pipe(n => n * 2)                      // ✅ n 自动推断 number，不用标注
  .pipe(($$ , bonus = 3) => $$ + bonus)  // ✅ $$ 自动推断 number
  .tap(n => console.log('current:', n))  // ✅ 副作用，值不变
  .parallel(                             // ✅ 并发，返回精确元组
    n => n + 1,
    n => n * 2,
  )
  .saveAs('result')                      // ✅ 快照，类型安全
  .run(5)                                // ✅ 外部 seed
```

全部特性，零类型标注（除了 `Pipeline<number>` 的初始类型）。

---

## $$-aware 步骤

`Prev<T>` 是带 brand 的类型标记：

```ts
export type Prev<T> = T & { readonly __fpipe_prev__: unique symbol }
```

`PrevStep<TIn, TOut>` 要求第一个参数是 `Prev<TIn>`，额外参数必须有默认值（这样运行时只需要传一个参数）。

运行时检测 `fn.length >= 2` 来判断是否是 $$-aware 步骤：

```ts
async run(input: TInput): Promise<TOutput> {
  const result = this.action.length >= 2
    ? await (this.action as PrevStep<TInput, TOutput>)(input as Prev<TInput>)
    : await (this.action as PlainStep<TInput, TOutput>)(input)
  this.after.emit(result)
  return result
}
```

---

## 三种设计的对比

| 特性 | 旧版 `Pipeline<Prev>` | 重构 v1 | 最终版 |
|------|------|------|------|
| 参数自动推断 | ✅ | ❌ | ✅ |
| `run(input)` 外部 seed | ❌ | ✅ | ✅ |
| $$-aware 步骤 | ✅（Symbol 魔法）| ❌ | ✅（`Prev<T>` brand）|
| 类型可读性 | ❌ `Conditional<GetFlag...>` | ✅ | ✅ |
| 运行时复杂度 | ❌ `Lazy.of(Multicast)` | ✅ 5行 | ✅ 10行 |

Overload 是这个设计的核心：联合类型无法做 contextual typing，但 overload 可以分别匹配，TypeScript 的类型推断引擎会从每个 overload 候选里找到能匹配的那个。

---

## 后记：保存中间值并跨步骤注入

重构完成后又加了一个特性：**带类型的中间值跨步骤注入**。

```ts
const p = new Pipeline<number>()
  .pipe(n => n * 2).saveAs('doubled')
  .pipe(n => n + 1).saveAs('incremented')
  .pipe(n => n * 3)                          // 普通步骤
  .pipe((current, $) => ({                   // $ 注入全部已保存值
    current,
    doubled: $['doubled'],                   // number ✓ 类型安全
    incremented: $['incremented'],           // number ✓
    sum: current + $['doubled'],
  }))

await p.run(5)
// doubled=10, incremented=11, current=33
// => { current: 33, doubled: 10, incremented: 11, sum: 43 }
```

`(current, $)` 是第三种步骤类型——**SavedStep**。它和 PlainStep、PrevStep 的区分方式很骚：

JavaScript 的 `Function.prototype.length` 返回**必填参数数量**，默认参数不计入：

```ts
(n => n * 2).length           // 1  → PlainStep
(($$, bonus = 3) => $$).length // 1  → PrevStep（默认参数不算）
((current, $) => $).length    // 2  → SavedStep（两个必填）
```

运行时只需要判断 `fn.length === 2` 就能区分 SavedStep，然后注入 `$` 对象。类型层的 overload 顺序匹配同样的信息——**运行时的 `fn.length` 和编译时的 overload 匹配，用的是同一个自然属性（参数数量），两层完全对称**。

---

> 类型系统应该为用户服务，不是让用户为类型系统服务。——但有时候值得多写几个 overload。

---

## v2.0.0 发布到 npm

[![npm version](https://img.shields.io/npm/v/typed-pipeline?style=flat-square&color=cb3837&logo=npm)](https://www.npmjs.com/package/typed-pipeline)
[![npm downloads](https://img.shields.io/npm/dm/typed-pipeline?style=flat-square&color=blue)](https://www.npmjs.com/package/typed-pipeline)

`typed-pipeline` v2.0.0 正式发布到 npm！经过多轮重构，这个版本终于把所有优点集齐，并且 API 稳定到可以对外发布的程度。

```bash
npm install typed-pipeline
```

### 完整用法示例

以下是涵盖全部新特性的完整示例：

```ts
import { Pipeline } from 'typed-pipeline'

const pipeline = new Pipeline<number>()
  // 1. 基础步骤 — 参数类型自动推断，无需标注
  .pipe(n => n * 2)                          // n: number ✓ 自动推断

  // 保存中间值，后续步骤可跨步骤引用
  .saveAs('doubled')                         // TSaved = { doubled: number }

  // 2. $$-aware 步骤 — $$ 自动推断为上一步输出类型，额外参数带默认值
  .pipe(($$ , bonus = 3) => $$ + bonus)      // $$: number ✓ 自动推断

  .saveAs('incremented')                     // TSaved = { doubled: number, incremented: number }

  // 3. $-accessor 步骤 — 通过第二个必填参数 $ 访问所有已保存的中间值
  .pipe((current, $) => ({
    current,
    doubled: $['doubled'],                   // number ✓ 类型安全
    incremented: $['incremented'],           // number ✓
    sum: current + $['doubled'],
  }))

  // 4. inject / withSaved — 手动注入或读取已保存的值
  // （下面演示 concat 场景：把多个管道合并）

await pipeline.run(5)
// doubled = 10
// incremented = 10 + 3 = 13
// current = 13 * 2 = 26（注：$$ 步骤输出再经 $-accessor 处理）
// => { current: 26, doubled: 10, incremented: 13, sum: 36 }
```

#### inject / withSaved / concat 示例

```ts
import { Pipeline } from 'typed-pipeline'

// 子管道：对数字做格式化
const formatter = new Pipeline<number>()
  .pipe(n => `¥${n.toFixed(2)}`)

// 主管道：注入外部值，concat 拼接子管道
const main = new Pipeline<number>()
  .pipe(n => n * 100)
  .saveAs('cents')
  .inject({ taxRate: 0.08 })               // 注入外部常量，后续 $ 可读
  .pipe((amount, $) => amount * (1 + $['taxRate']))
  .saveAs('total')
  .concat(formatter)                        // 拼接子管道，类型自动衔接

const result = await main.run(9.99)
// => "¥1078.92"
```

---

### 原理速查

运行时通过 `Function.prototype.length`（**必填**参数数量，默认参数不计入）区分三种步骤类型，编译时 overload 顺序与运行时规则完全对称：

| `fn.length` | 步骤类型 | 调用方式 | 典型写法 |
|:-----------:|----------|----------|----------|
| `1` | **PlainStep** | `fn(input)` | `n => n * 2` |
| `1`（有默认参数） | **PrevStep**（$$-aware）| `fn(input)` | `($$, bonus = 3) => $$ + bonus` |
| `2` | **SavedStep**（$-accessor）| `fn(input, savedMap)` | `(current, $) => current + $['doubled']` |

> **为什么 PrevStep 的 `fn.length` 也是 1？**
> JavaScript 中默认参数不计入 `length`，所以 `($$, bonus = 3) => ...` 的 `length === 1`，与 PlainStep 区分靠的是 TypeScript overload 的类型检查——编译期 brand 类型 `Prev<T>` 确保第一个参数被标注为"上一步输出"，运行时则统一只传一个参数。

---

> `typed-pipeline` 的核心哲学：**让类型系统的语义与运行时的行为完全对称**——overload 如何匹配，`fn.length` 就如何判断，两者用同一把尺子量。
