---
title: "typed-pipeline 内部设计：fn.length 如何统一运行时与类型系统"
date: 2026-03-20
description: 用 JavaScript 的 fn.length 区分三种管道步骤——一个意外优雅的设计
tag:
  - TypeScript
  - typed-pipeline
  - 设计
article: false
outline: [2, 3]
---

这篇文章讲一个具体的设计决策：`typed-pipeline` 里怎么让 `.pipe()` 同时支持三种不同的步骤类型，又不需要用户写任何额外的包装或装饰器。

答案是 `fn.length`——一个 JavaScript 里几乎被遗忘的属性，在这里却成了整个设计的支点。

- GitHub: [bkmashiro/typed-pipeline](https://github.com/bkmashiro/typed-pipeline)

---

## 问题：一个 `.pipe()` 三种行为

`typed-pipeline` 支持三种步骤：

```ts
new Pipeline<number>()
  .pipe(n => n * 2)                       // 1. 普通转换
  .pipe(($$ , bonus = 3) => $$ + bonus)   // 2. 访问"上一步结果"，带可选额外参数
  .saveAs('doubled')
  .pipe((current, $) => current + $['doubled'])  // 3. 访问所有已保存的中间值
```

这三种步骤的签名完全不同，行为也不同：

- **PlainStep**：`(input) => output`，最基础的变换
- **PrevStep**：第一个参数接收上一步输出，额外参数可选（带默认值）
- **SavedStep**：两个必填参数，第二个 `$` 是所有已保存值的映射

如果用三个不同的方法（`.pipe()` / `.pipeWith$$()` / `.pipeWithSaved()`），类型层会简单很多，但用起来丑。目标是让用户直接写函数，`.pipe()` 自己判断该怎么调用它。

怎么区分？

---

## 关键发现：`fn.length` 只计必填参数

JavaScript 里，`Function.prototype.length` 返回的是**必填参数数量**，带默认值的参数不算：

```ts
((n: number) => n * 2).length
// → 1

(($$ : number, bonus = 3) => $$ + bonus).length
// → 1  ← 默认参数不算！

((current: number, $: Record<string, any>) => current + $['x']).length
// → 2  ← 两个都是必填
```

这个属性平时很少被关注，但它在这里有一个意外完美的特性：

- PrevStep 的额外参数（`bonus = 3`）必须有默认值——因为运行时只传一个参数给它
- 这个设计约束，反而让 `fn.length` 能精确区分 PrevStep 和 SavedStep

PrevStep 和 PlainStep 的 `fn.length` 都是 1，SavedStep 是 2。这就够了。

---

## 三种步骤的区分

用表格说清楚：

| 写法 | `fn.length` | 类型 | 运行时调用 |
|------|:-----------:|------|------------|
| `n => n * 2` | `1` | PlainStep | `fn(input)` |
| `($$, bonus = 3) => $$ + bonus` | `1` | PrevStep | `fn(input)`（只传一个） |
| `(current, $) => $['key']` | `2` | SavedStep | `fn(input, savedMap)` |

PrevStep 和 PlainStep 在运行时无法区分（都是 `fn(input)`），但也不需要——它们的调用方式完全相同。SavedStep 需要 `fn.length === 2` 来识别，然后额外传入 `$` 对象。

---

## 运行时分发：5 行代码

`Job.run()` 里的核心逻辑非常简单：

```ts
async run(input: TInput): Promise<TOutput> {
  const result = this.action.length >= 2
    ? await (this.action as SavedStep<TInput, TOutput>)(input, this.savedMap)
    : await (this.action as PlainStep<TInput, TOutput> | PrevStep<TInput, TOutput>)(input)
  this.after.emit(result)
  return result
}
```

`fn.length >= 2` → SavedStep，传入 `savedMap`；否则，统一只传一个参数。

就这样。没有反射，没有 Symbol 检测，没有 WeakMap 查找。一个属性访问，一个条件分支。

---

## 类型层的 overload 顺序

运行时用 `fn.length` 区分步骤，编译时用 overload。`.pipe()` 有三个签名：

```ts
// 1. SavedStep 排第一——有两个必填参数
pipe<TNext>(
  step: (current: TOutput, saved: TSaved) => MaybePromise<TNext>
): Pipeline<TInput, TNext, TSaved>

// 2. PrevStep——第一个参数是 Prev<T>（brand 类型），额外参数带默认值
pipe<TNext>(
  step: PrevStep<TOutput, TNext>
): Pipeline<TInput, TNext, TSaved>

// 3. PlainStep——最普通的情况
pipe<TNext>(
  step: PlainStep<TOutput, TNext>
): Pipeline<TInput, TNext, TSaved>
```

**顺序很重要**。TypeScript 对 overload 是从上往下依次尝试，匹配到第一个能用的就停。

SavedStep 必须排第一：如果 PlainStep 排在前面，`(current, $) => ...` 会被错误地匹配为 PlainStep（因为结构上也符合 `(arg) => ...` 的形状——TypeScript 会忽略多余参数）。

SavedStep 有两个必填参数，结构更具体，排前面才能让 contextual typing 正确工作：`$` 会被推断为 `TSaved`，而不是 `unknown`。

---

## 对称之美

这个设计有一个我很喜欢的地方：**运行时和编译时用的是同一个信息**。

运行时：`fn.length >= 2` → SavedStep  
编译时：overload 按参数数量从多到少排列，SavedStep 先匹配

两层完全独立实现——一个是 JS 运行时的属性访问，一个是 TypeScript 类型检查器的 overload 解析。但它们对"什么是 SavedStep"的判断标准完全一致：参数数量。

不需要任何同步机制，不需要运行时类型标记，不需要 Symbol 或 WeakMap。**两层自然对齐，因为它们描述的是同一件事**。

这种对称在系统设计里很少见。通常运行时和类型层需要各自维护一套逻辑，稍有不同步就会出 bug。这里不存在这个问题。

---

## 限制：PrevStep 的约束不是 bug

PrevStep 要求额外参数必须有默认值：

```ts
// ✅ 合法
pipe(($$ , bonus = 3) => $$ + bonus)

// ❌ 不合法——运行时只传一个参数，bonus 会是 undefined
pipe(($$ , bonus: number) => $$ + bonus)
```

这是设计约束，不是实现缺陷。运行时统一只传一个参数（`fn(input)`），所以额外参数只能靠默认值获取。如果写了必填的额外参数，运行时会静默地传入 `undefined`，结果不可预期。

类型层通过 `PrevStep<T>` 的定义来约束这一点：

```ts
export type PrevStep<TIn, TOut> = (
  prev: Prev<TIn>,
  ...rest: DefaultOnly[]  // 所有额外参数必须有默认值
) => MaybePromise<TOut>
```

`DefaultOnly` 是一个辅助类型，确保额外参数在类型上是可选的。运行时不需要检查——TypeScript 在编译期已经拦住了。

---

## 小结

`fn.length` 统一运行时与类型系统，靠的不是什么魔法，而是一个自然的巧合：

1. JavaScript 的 `Function.prototype.length` 只计必填参数
2. 三种步骤恰好在必填参数数量上有区别（1 vs 2）
3. PrevStep 的"额外参数必须带默认值"既是运行时需要，也是这个区分方案能工作的前提

结果是：运行时 5 行 `if/else`，编译时 3 个 overload，两层各自独立却完全对齐。

> 好的设计约束往往不是限制，而是让两个东西自然对齐的那根钉子。
