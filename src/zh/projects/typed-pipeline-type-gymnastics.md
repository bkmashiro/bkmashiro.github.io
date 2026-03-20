---
title: "TypeScript 5 类型体操：给管道库做编译期类型验证"
date: 2026-03-20
description: "用 TS5 的 infer extends、const 类型参数、NoInfer、递归条件类型和模板字面量，给 typed-pipeline 实现编译期步骤类型链验证——以及这些技法背后的原理。"
readingTime: true
tag:
  - TypeScript
  - 类型系统
  - 类型体操
  - 函数式
outline: [2, 3]
---

最近给 [typed-pipeline](https://github.com/bkmashiro/typed-pipeline) 升级到 TypeScript 5，顺手把类型系统能力拉满了。这篇文章记录用到的每一个类型技法。

---

## 目标

我们要实现的是：

```ts
const p = fpipe(
  (x: number) => x * 2,       // number → number
  (n: number) => `val: ${n}`,  // number → string
  (s: string) => s.length,     // string → number
)

await p(5)  // Promise<number>，类型正确推断
```

以及，如果类型不匹配，**在编译期报错**：

```ts
const p = fpipe(
  (x: number) => x * 2,
  (s: string) => s.length,  // ❌ 编译错误：上一步输出 number，这里期望 string
)
```

完全不需要运行时检查，纯类型层。

---

## TS 5 新特性速查

本文用到的：

| 特性 | 版本 | 说明 |
|------|------|------|
| `infer X extends Constraint` | 4.8 | 约束 infer 变量 |
| 递归条件类型 | 4.1 | 类型层递归 |
| 可变元组 | 4.0 | `[...T]` 展开 |
| `const` 类型参数 | 5.0 | 保留字面量类型 |
| `NoInfer<T>` | 5.4 | 阻止类型参数被特定位置推断 |
| 模板字面量类型 | 4.1 | `` `error at step ${N}` `` |

---

## 步骤一：提取步骤的输入输出类型

```ts
type Awaited_<T> = T extends Promise<infer U> ? Awaited_<U> : T

// 输出类型：解包 Promise
type StepOutput<S> =
  S extends (arg: any, ...rest: any[]) => MaybePromise<infer O>
    ? Awaited_<O>
    : never

// 输入类型：区分普通步骤和 $$-aware 步骤
type StepInput<S> =
  S extends PlainStep<infer TIn, any> ? TIn :
  S extends ($$: Prev<infer TIn>, ...rest: any[]) => any ? TIn :
  never
```

`Prev<T>` 是带 brand 的类型，用来标记 "$$-aware" 步骤：

```ts
export type Prev<T> = T & { readonly __fpipe_prev__: unique symbol }
```

`unique symbol` 让每个 `Prev<T>` 在结构类型系统里名义上唯一，不会和普通 `T` 混淆。

---

## 步骤二：递归穿线类型

这是核心——把一个步骤元组的类型从头到尾"穿"起来：

```ts
type ThreadPipeline<
  Steps extends readonly AnyStep[],
  Seed,
> = Steps extends readonly []
  ? Seed
  : Steps extends readonly [
      infer Head extends AnyStep,   // ← TS 4.8: infer + 约束
      ...infer Tail extends readonly AnyStep[],
    ]
  ? ThreadPipeline<Tail, StepOutput<Head>>
  : never
```

`infer Head extends AnyStep` 是 TS 4.8 引入的语法——在 infer 的同时约束推断出的类型。旧版 TS 需要写成两步：

```ts
// TS < 4.8 的写法（啰嗦）
: Steps extends readonly [infer Head, ...infer Tail]
  ? Head extends AnyStep
    ? Tail extends readonly AnyStep[]
      ? ThreadPipeline<Tail, StepOutput<Head>>
      : never
    : never
  : never
```

新写法清晰太多了。

---

## 步骤三：编译期类型兼容验证

光推断输出类型还不够——我们还要在步骤不兼容时给出有意义的错误。

```ts
type ValidateSteps<
  Steps extends readonly AnyStep[],
  _Prev = never,          // 上一步的输出类型
  Index extends number = 0,
> = Steps extends readonly []
  ? true
  : Steps extends readonly [infer Head extends AnyStep, ...infer Tail extends readonly AnyStep[]]
  ? [_Prev] extends [never]                    // 第一步没有 Prev，跳过检查
    ? ValidateSteps<Tail, StepOutput<Head>, Add1<Index>>
    : StepInput<Head> extends _Prev            // 检查当前步骤输入是否兼容上一步输出
      ? ValidateSteps<Tail, StepOutput<Head>, Add1<Index>>
      : `Type error at step ${Index}: expected input assignable to '${Extract<_Prev, string>}'`
                                               // ↑ 模板字面量错误信息
  : never
```

模板字面量类型（`` `Type error at step ${Index}` ``）让编译错误信息直接显示在 IDE 里。`Add1<N>` 是一个编译期的 +1 运算：

```ts
type Add1<N extends number> =
  [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16][N]
```

用数组下标做加法——类型系统里没有算术，但有数组索引。

---

## 步骤四：const 类型参数 + NoInfer

这是让整件事能工作的关键：

```ts
export function fpipe<
  const Steps extends readonly AnyStep[],  // ← const (TS 5.0)
  Seed extends StepInput<Steps[0]>,
>(
  ...steps: Steps & (ValidateSteps<Steps> extends true ? Steps : never)
): (input: NoInfer<Seed>) => Promise<PipelineOutput<Steps, Seed>>
```

### `const` 类型参数（TS 5.0）

没有 `const`，TypeScript 会把元组类型宽化：

```ts
// 没有 const：Steps 被推断为 AnyStep[]（信息丢失）
// 有 const：Steps 被推断为精确的元组 readonly [(n: number) => number, ...]
```

`const` 让 TypeScript 保留元组的完整形状，递归类型才能正确工作。

### `NoInfer<T>`（TS 5.4）

```ts
): (input: NoInfer<Seed>) => Promise<...>
```

`NoInfer<T>` 告诉 TypeScript："不要用这个位置来推断 `Seed` 的类型"。

这解决了一个微妙问题：如果不加 `NoInfer`，TypeScript 可能尝试从返回函数的调用处反向推断 `Seed`，导致类型循环或意外宽化。`NoInfer` 让 `Seed` 只从 `Steps[0]` 的输入类型推断，行为更可预测。

---

## 效果展示

**类型正确推断：**

```ts
const p = fpipe(
  (x: number) => x * 2,
  (n: number) => `val: ${n}`,
)
// p: (input: number) => Promise<string> ✓
```

**类型不兼容时报错：**

```ts
const p = fpipe(
  (x: number) => x * 2,
  (s: string) => s.length,  // 传入的是 number，这里期望 string
)
// 错误：Argument of type '...' is not assignable to parameter of type 'never'
// 因为 ValidateSteps 返回了字符串（错误信息）而不是 true
```

**`$$` 注入步骤的类型也正确：**

```ts
const p = fpipe(
  (x: number) => x * 2,
  ($$: Prev<number>, bonus = 5) => $$ + bonus,  // $$ 类型 = number ✓
)
// p: (input: number) => Promise<number> ✓
```

---

## 运行时实现（才 5 行）

有趣的是，类型层写了 80 行，运行时实现极其简单：

```ts
export function fpipe(...steps: AnyStep[]): (input: unknown) => Promise<unknown> {
  return async (input: unknown) => {
    let current: unknown = input
    for (const step of steps) {
      current = await step(current as never)
    }
    return current
  }
}
```

所有复杂性都在类型层消化掉了。这是 TypeScript 类型系统最迷人的地方：运行时可以很简单，类型可以很严格。

---

## 番外：为什么 Pipeline 类能做到参数自动推断

`fpipe(...)` 函数式 API 需要手动标注参数类型，但 `Pipeline` 类不需要：

```ts
// Pipeline 类：自动推断 ✅
new Pipeline<number>()
  .pipe(n => n * 2)   // n: number，不用写
  .pipe(n => `${n}`)  // n: number，不用写

// fpipe：需要手动标注 ❌
fpipe(
  (x: number) => x * 2,
  (n: number) => `${n}`,  // 必须写 n: number
)
```

原因：TypeScript 的 contextual typing 在**逐步调用**时工作，在 **rest 参数**时不工作。

`.pipe(n => ...)` 是独立调用，`TOutput` 在调用时已经确定，TS 能推断 `n` 的类型。`fpipe(s1, s2, s3)` 是一次调用三个参数同时传入，TS 没有"先确定 s1 的输出再推断 s2 的输入"的机制。

另一个关键是 **Overload vs Union**：

```ts
// ❌ Union — TS 不知道对哪个类型做 contextual typing
pipe<TNext>(step: PlainStep<TOutput, TNext> | PrevStep<TOutput, TNext>): ...

// ✅ Overload — TS 对每个候选分别尝试，找到匹配的
pipe<TNext>(step: PlainStep<TOutput, TNext>): ...
pipe<TNext>(step: PrevStep<TOutput, TNext>): ...
```

Overload 分开后，两种步骤（普通步骤和 `$$-aware` 步骤）都能自动推断参数类型。

---

## 总结

用到的每个技法：

- **`infer X extends Constraint`** — 一次性 infer + 约束，替代 TS 4.8 前的嵌套写法
- **递归条件类型** — 把步骤元组递归穿线，每次"消耗"一个步骤
- **`const` 类型参数** — 保留元组字面量类型，让递归有信息可以工作
- **`NoInfer<T>`** — 控制类型推断方向，防止意外宽化
- **模板字面量类型** — 在编译错误信息里嵌入步骤索引，让报错可读
- **`unique symbol` brand** — 名义类型，区分 `Prev<T>` 和普通 `T`
- **数组下标加法** — 在类型层做 +1，绕过类型系统没有算术的限制
- **Overload vs Union** — 联合类型无法 contextual typing，overload 逐个匹配可以

代码在 [bkmashiro/typed-pipeline](https://github.com/bkmashiro/typed-pipeline/blob/main/src/fpipe.ts)。
