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

> 类型系统应该为用户服务，不是让用户为类型系统服务。——但有时候值得多写几个 overload。
