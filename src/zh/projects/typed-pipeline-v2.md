---
title: "typed-pipeline 重构：从 $$ 魔法到 Pipeline<In, Out>"
date: 2026-03-20
description: "把一个用符号魔法实现的 TypeScript Pipeline 库重构成双泛型、可读、可测试的干净 API——以及为什么原来的设计是个错误。"
readingTime: true
tag:
  - TypeScript
  - 类型系统
  - 重构
  - 函数式
outline: [2, 3]
---

`typed-pipeline` 是我之前做的一个 TypeScript 管道组合库。最近回头看旧代码，觉得必须重写。

- GitHub: [bkmashiro/typed-pipeline](https://github.com/bkmashiro/typed-pipeline)

---

## 旧版：符号魔法

旧版的核心设计是一个叫 `$$` 的 Symbol，用来表示"上一步的结果"：

```ts
const pipeline = pipe(
  (x: number) => x * 2,
  ($$, y: number) => $$ + y,  // $$ = 前一步结果
)
```

乍看还挺聪明——通过参数位置推断依赖关系。但实际用起来问题很多：

1. **类型推断断层** — TypeScript 的类型系统不擅长推断 Symbol 参数的位置语义，经常需要手动标注类型
2. **`WarpedValue` 和 `Lazy`** — 为了处理异步和延迟求值，加了两个包装类型，但它们会污染用户代码
3. **看不懂** — 新人看到 `$$` 完全不知道这是什么意思

旧版还有 300+ 行类型体操，里面有各种 `Conditional`、`GetFlagAndEquals`、`IsWaitable` 之类的工具类型，实际上大半是为了打补丁。

---

## 新版：Pipeline<In, Out>

重构的目标很简单：**干掉所有魔法，用最直白的方式表达"数据流"**。

```ts
const pipeline = new Pipeline<number>()
  .pipe((n) => n * 2)
  .pipe((n) => `value: ${n}`)

await pipeline.run(5)  // "value: 10"
```

核心设计：

```ts
class Pipeline<TInput, TOutput = TInput> {
  pipe<TNext>(step: (input: TOutput) => MaybePromise<TNext>): Pipeline<TInput, TNext>
  parallel<TSteps>(...steps: TSteps): Pipeline<TInput, ParallelResults<TSteps>>
  bypass(step: (v: TOutput) => MaybePromise<unknown>): Pipeline<TInput, TOutput>
  saveAs<K extends string>(key: K): Pipeline<TInput, TOutput, Saved & Record<K, TOutput>>
  run(input: TInput): Promise<TOutput>
}
```

双泛型 `<TInput, TOutput>` 让类型沿着整条链正确传播，不需要任何 Symbol 或包装类型。

### parallel — 并发分支

```ts
const pipeline = new Pipeline<number>()
  .parallel(
    (n) => n + 1,
    (n) => n * 2,
    async (n) => n ** 2,
  )

await pipeline.run(3)  // [4, 6, 9]
```

类型推断是精确的元组类型：`[number, number, number]`。

### saveAs / getResult — 保存中间值

```ts
const p = new Pipeline<number>()
  .pipe((n) => n * 2).saveAs('doubled')
  .pipe((n) => n + 1)

await p.run(5)
p.getResult('doubled')  // 10（类型安全）
```

用 `TSaved extends SavedResults` 第三个泛型参数跟踪已保存的 key，`getResult` 的返回类型是精确的。

### bypass / tap — 副作用

```ts
new Pipeline<string>()
  .tap((s) => console.log('before:', s))
  .pipe((s) => s.toUpperCase())
  .tap((s) => console.log('after:', s))
  .run('hello')
```

不改变值，只执行副作用。`tap` 是 `bypass` 的别名。

---

## 实现细节

每个步骤包装成 `Job` 对象，执行后通过 `Multicast` 广播结果（供 `saveAs` 订阅）：

```ts
class Job<TInput, TOutput> {
  async run(input: TInput): Promise<TOutput> {
    const result = await this.action(input)
    this.config.after.emit(result)  // 通知 saveAs 订阅者
    return result
  }
}
```

`Pipeline` 本身是不可变的——每次 `.pipe()` 都返回新实例，共享 `results` Map：

```ts
pipe<TNext>(step: Step<TOutput, TNext>): Pipeline<TInput, TNext> {
  const jobs = [...this.jobs, new Job(step)]
  return new Pipeline(jobs, this.results)  // 共享同一个 results
}
```

---

## 删了什么

重构删掉了：

- `$$` Symbol 和所有依赖它的类型逻辑
- `WarpedValue<T>` 包装类型
- `Lazy<T>` 延迟求值包装
- 150+ 行类型工具（`Conditional`、`GetFlagAndEquals`、`IsWaitable`……）

从 324 行缩到 123 行。7 个测试，覆盖率 95%+。

---

类型系统应该为用户服务，不是让用户为类型系统服务。有时候最好的类型体操是不写类型体操。
