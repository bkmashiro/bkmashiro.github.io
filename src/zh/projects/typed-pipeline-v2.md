---
title: "typed-pipeline v2 — 类型安全的异步管道库"
date: 2026-03-21
tags: [typescript, typed-pipeline, async, library-design]
description: "typed-pipeline v2.0 的核心设计：为什么回到 Pipeline 类、AsyncPipeline 如何处理异步步骤、parallel 的元组推断，以及 saveAs 的快照语义。"
readingTime: true
tag:
  - TypeScript
  - typed-pipeline
  - 异步
  - 库设计
outline: [2, 3]
---

`typed-pipeline` v2.0 的目标不是把 API 做得更花，而是把三个经常互相冲突的东西放进同一个设计里：链式可读性、异步可组合性，以及 TypeScript 级别的类型安全。

在 v1 里，我已经验证了“管道 + 上一步结果推断”这条路线可行；问题是旧实现依赖太多技巧性结构，运行时和类型层都不够直。v2 的设计决策因此很明确：运行时必须像普通库一样可读，类型系统必须只表达真正存在的语义，而不是为了补洞引入一层又一层工具类型。

---

## 为什么回到 `Pipeline` 类

v2 最重要的决定，是放弃纯函数式拼装器，回到 `new Pipeline<TInput>()` 这种类式 API。

原因很现实。类把“当前输出类型”“已保存快照”“待执行步骤”三块状态聚合在一个实例上，链式调用时 TypeScript 可以沿着 `this` 的泛型继续推断。相比之下，纯函数 `pipe(a, b, c)` 虽然短，但一旦要支持 `.saveAs()`、`.parallel()`、`.tap()` 这种会改变上下文的操作，类型签名很快会膨胀到不可维护。

`Pipeline<TIn, TOut, TSaved>` 这个三泛型模型基本对应真实运行时：

```ts
class Pipeline<TInput, TOutput = TInput, TSaved = {}> {
  pipe<TNext>(step: Step<TOutput, TNext, TSaved>): Pipeline<TInput, TNext, TSaved>
  saveAs<TKey extends string>(key: TKey): Pipeline<TInput, TOutput, TSaved & Record<TKey, TOutput>>
  run(input: TInput): Promise<TOutput>
}
```

`TInput` 是外部 seed 类型，`TOutput` 是当前步骤链尾部的值，`TSaved` 是所有 `saveAs()` 形成的命名快照。这个模型的好处是，用户看见的每个泛型都能在运行时找到对应物，不存在“只为类型体操存在”的幽灵概念。

---

## `AsyncPipeline` 不是另一套 DSL

第二个设计决策是把异步当成默认能力，而不是额外插件。现实里的数据处理步骤常常混合同步计算、数据库查询、HTTP 请求和副作用，如果同步管道和异步管道是两套 API，用户迟早会在中间遇到边界摩擦。

所以 v2 里 `Pipeline` 的步骤返回 `MaybePromise<T>`，而 `AsyncPipeline` 更像一个语义别名：它强调“这条链明确以异步为主”，但底层调度模型与 `Pipeline` 一致，都是逐步 `await` 前一个步骤的结果。

```ts
const p = new AsyncPipeline<UserId>()
  .pipe(id => loadUser(id))
  .pipe(async user => ({
    ...user,
    posts: await loadPosts(user.id),
  }))
  .pipe(user => user.posts.length)

const count = await p.run("u_42")
```

这背后的关键不是“支持 Promise”这么简单，而是保证每个步骤看到的输入类型是 `Awaited<上一步输出>`。也就是说，异步只改变调度，不改变用户的心智模型。写第三步的人不需要关心第二步到底是同步函数还是 `async` 函数，只需要知道它最终产出的值是什么。

---

## `parallel` 步骤的设计

很多管道库有并行能力，但常见做法是把并行结果降成 `unknown[]` 或宽泛数组类型。这样运行时能工作，类型层却丢了信息。v2 的 `parallel` 选择另一条路：把“并行”视为“对同一输入运行多个子步骤，并保留结果元组形状”。

```ts
const p = new Pipeline<number>()
  .parallel(
    n => n + 1,
    async n => n * 2,
    n => `v=${n}`,
  )

const result = await p.run(5)
// [6, 10, "v=5"]
```

这里返回值不是 `(number | string)[]`，而是精确的 `[number, number, string]`。实现上，`parallel` 会把当前输出 `TOutput` 作为每个分支的统一输入，再通过变长元组映射得到结果：

```ts
type ParallelResult<TIn, TSteps extends readonly AnyStep[]> = {
  [K in keyof TSteps]: StepOutput<TSteps[K], TIn>
}
```

运行时则只是一次 `Promise.all`。这正是 v2 的总体风格：把复杂性尽量收束在“与用户收益直接相关”的位置。并发调度本身没有必要复杂，真正值得保留的是分支结果的精确形状，因为后续步骤往往会直接解构这个元组。

---

## `saveAs` 的语义：保存快照，不是保存引用名

`saveAs` 是 v2 里最容易被误解、但也最关键的 API。它的语义不是“给当前值取一个别名”，而是“把当前步骤的输出快照加入已保存上下文，供后续步骤显式读取”。

```ts
const p = new Pipeline<number>()
  .pipe(n => n * 2)
  .saveAs("doubled")
  .pipe(n => n + 3)
  .pipe((current, $) => current + $.doubled)
```

这里 `$.doubled` 永远是保存时的值 `10`，而不是“某个会跟着 current 一起变化的引用”。如果把 `saveAs` 设计成别名，后续优化、并行步骤、甚至重复运行都很容易出现语义歧义：到底读的是链上当前位置，还是历史节点？

v2 选择快照语义后，事情就很清楚了：

- `saveAs("x")` 发生在某一个确定步骤之后。
- 它把那一刻的输出写入内部 `saved` 对象。
- 后续步骤只能读取，不能隐式回写。

于是 `TSaved` 的类型也自然成立。`saveAs("doubled")` 后，后面的步骤拿到的 `$` 类型就是 `{ doubled: number }`；再保存一次 `"formatted"`，类型就扩展成 `{ doubled: number; formatted: string }`。类型系统描述的，正是历史快照集合。

---

## 一个完整例子

把这些设计拼起来，v2 的典型用法会像这样：

```ts
const pipeline = new AsyncPipeline<string>()
  .pipe(id => loadUser(id))
  .saveAs("user")
  .parallel(
    user => loadProfile(user.id),
    user => loadTeams(user.id),
  )
  .pipe(async ([profile, teams], $) => ({
    id: $.user.id,
    profile,
    teams,
  }))
```

这段代码里，类负责承载上下文；异步步骤自然串联；`parallel` 保留 `[Profile, Team[]]` 的元组结构；`saveAs` 提供稳定的历史快照。四个特性不是硬拼在一起，而是围绕同一个状态模型展开。

---

## 结语

我对 v2 最满意的地方，不是“功能更多”，而是每个功能终于有了稳定边界。`Pipeline` 负责链式状态，`AsyncPipeline` 负责异步心智模型，`parallel` 负责同输入多分支，`saveAs` 负责历史快照。它们组合起来像一个库，而不是一组聪明但彼此松散的技巧。

对 TypeScript 库来说，这一点比多几个花哨 API 更重要：运行时模型越清楚，类型系统就越容易保持诚实。
