---
title: "RedScript 2.0–2.2：从玩具到正经语言"
date: 2026-03-16
description: "从下午到午夜的一个开发马拉松：枚举、泛型、Option<T>、LSP、协程、源码映射、增量编译——以及一堆只有在真实 Minecraft 里加载数据包时才会出现的 bug。"
readingTime: true
tag:
  - Minecraft
  - TypeScript
  - 编译器
  - RedScript
outline: [2, 3]
---

现在已经过了午夜，我刚刚推送了 RedScript 2.2.1。测试套件从 877 个增长到 1136 个。版本号在一天内从 2.0.0 跳到了 2.2.1。大多数实际代码是由 Claude 写的，但我是那个不断把数据包加载进真实 Minecraft 服务器、看着东西以各种有趣方式崩溃的人。

让我来讲讲发生了什么。

- GitHub：[bkmashiro/redscript](https://github.com/bkmashiro/redscript)
- npm：[redscript-mc](https://www.npmjs.com/package/redscript-mc)
- 文档：[redscript-docs.pages.dev](https://redscript-docs.pages.dev)
- 在线 IDE：[redscript-ide.pages.dev](https://redscript-ide.pages.dev)

---

## 背景：RedScript 是什么？

RedScript 是一种编译为 Minecraft 数据包的类 TypeScript 语言。它不在 JS 引擎里运行，而是编译为 `.mcfunction` 文件——用计分板作为变量，用 NBT 存储作为「内存」，用宏做动态分发，用 Minecraft 命令执行模型作为运行时。

```redscript
// 这是合法的 RedScript
function fibonacci(n: int): int {
  if (n <= 1) return n
  return fibonacci(n - 1) + fibonacci(n - 2)
}
```

```mcfunction
# 这是它编译成的东西（简化版）
scoreboard players operation $a0 rs = $p0 rs
# ... 还有 40 多行计分板运算
```

这很荒诞，也令人愉悦，而且它确实有效。1.x 系列证明了概念可行；2.x 才是你真正会想用的版本。

---

## 今天落地的语言特性

### 类型系统升级

**枚举** — 真正的判别联合类型，不仅仅是整型别名。编译器在编译时知道所有变体，并生成优化过的计分板检查。

**泛型** — `Stack<T>`、`List<T>`，在编译时单态化。编译器为每种类型生成独立的实例化。是的，这会导致代码膨胀，但我现在不在乎。

**`Option<T>`** — `None` 用哨兵计分板值表示。`unwrap()` 会 panic（基本上是用 `/kill @s` 杀死函数）。`map()` 和 `flatMap()` 生成你期望的分支 mcfunction 调用。

```redscript
// 之前：所有东西都可能悄悄变成垃圾值
function getBlock(pos: BlockPos): int {
  return readNBT(pos)  // 如果区块未加载可能是 undefined 😬
}

// 之后：明确表达可能失败
function getBlock(pos: BlockPos): Option<int> {
  if (!isChunkLoaded(pos)) return None
  return Some(readNBT(pos))
}
```

**TypeChecker 严格模式** — 以前类型检查器比较乐观，现在它会对隐式 `any`、缺少返回类型和不兼容数值类型间的运算大声抱怨。

### 基础设施

**增量编译** — 在 manifest 中追踪文件哈希，未修改的文件不会重新编译。在中等规模项目上，重新构建时间从 ~8s 降至 ~1s。

**源码映射** — 错误信息现在指向原始的 `.mcrs` 文件和行号，而不是生成的 `.mcfunction`。这听起来无聊，但调试时真的是天壤之别。

**LSP（语言服务器协议）** — 悬停显示类型、自动补全、跳转到定义。你现在可以在 VS Code 中写 RedScript，并有完整的 IntelliSense。这是单项最大的体验提升。

### Minecraft 原生特性

**`@coroutine` 装饰器** — 这个很聪明。Minecraft 以 20 ticks/秒运行。如果你的函数在一个 tick 内做了太多工作，服务器就会卡顿。`@coroutine` 包装函数，让它每 N 个 tick 让出控制权，将工作分散到多个游戏周期。

```redscript
@coroutine(tickBudget: 5)
function processAllEntities(entities: Entity[]): void {
  for (const entity of entities) {
    heavyProcessing(entity)  // 每 5 个 tick 自动让出给 MC
  }
}
```

**`@schedule`** — 在函数上加 `@schedule(20)` 让它每 20 tick（每秒）运行一次。是 `schedule function ... 20t` 的语法糖。

**模块系统** — `import` / `export`，有完整的命名空间隔离。多个 `.mcrs` 文件现在可以共享类型和函数，不会污染全局计分板命名空间。

---

## 只有在真实 Minecraft 里才会出现的 Bug

这是关于测试 Minecraft 编译器的真相：模拟器是个谎言。

不是恶意的谎言——它对规格的实现很忠实。但真实 Minecraft 服务器有一些没有任何规格记录的怪癖。你只有在把数据包 `git clone` 下来、放进 `world/datapacks/`、运行 `/reload`、看着错误日志时才会发现它们。

### Bug 1：双空格

```mcfunction
execute  run function mypack:myfunction
```

发现了吗？`execute` 和 `run` 之间有**两个空格**。我的 IR 到 mcfunction 生成器有一个模板字符串：

```typescript
const cmd = `execute ${condition} run function ${fnName}`
```

当 `condition` 是空字符串（无条件 execute）时，就会得到 `execute  run function`——双空格。模拟器中的所有单元测试都通过了，因为模拟器的命令解析器会修剪空白。真实的 Minecraft 解析器不会。它返回 `Unknown command`，然后悄悄地什么都不做。

我是在晚上 11 点盯着生成的 `.mcfunction` 文件，想知道为什么我的条件块没有执行时发现这个问题的。

### Bug 2：BlockPos 坐标变成 `undefined`

```redscript
const pos: BlockPos = { x: 10, y: 64, z: -30 }
teleportTo(pos)
```

在模拟器里：正常工作。在 Minecraft 里：传送到 `10 undefined -30`，崩溃。

原因：BlockPos 存储为三个独立的计分板值（`pos.x`、`pos.y`、`pos.z`）。结构体字段访问的代码生成有个 bug，负数字面值不会被输出——它们会输出字段名但没有值赋值，让计分板槽位保持之前（未初始化）的 `0` 值。修复是在字面量输出路径里的一行代码。**找到**它花了两个小时。

### Bug 3：协程 + 宏函数

`@coroutine` 包装器通过写入 NBT 存储来跨 tick 保存和恢复执行状态。`@macro` 装饰器让函数使用 MC 的 `$()` 宏替换进行动态分发。把两者结合时，宏上下文会被序列化进协程状态 NBT……但 Minecraft 处理宏复合数据的方式意味着重新调用时无法正确重建它。

修复方案：协程现在在挂起前提前求值所有宏参数，恢复时传入具体值。你损失了一些性能，但得到了正确的行为。正确 > 快。

### Bug 4：数组索引访问编译成 `const 0`

```redscript
function first<T>(arr: T[]): T {
  return arr[0]
}
```

`arr[0]` 编译后的输出：

```mcfunction
# 期望：读取 arr[0] 到结果寄存器
# 实际：
scoreboard players set $result rs 0
```

泛型单态化通道在替换 `T` 为具体类型时忘记更新数组访问表达式节点。所有对 `first()` 的调用都返回 0，不管数组里装了什么。

这个通过了所有 877 个单元测试，因为没有任何测试用严格模式测试带数组索引返回的泛型函数。添加了 47 个新测试，修复了代码生成，现在有 1136 个测试。

---

## 数字总结

| 指标 | 之前 | 之后 |
|------|------|------|
| 版本 | 2.0.0 | 2.2.1 |
| 测试数 | 877 | 1136 |
| 语言特性 | 枚举、基本泛型 | + Option\<T\>、严格类型检查器、协程、LSP、模块系统 |
| 标准库 | math, bigint | + timer, scheduler, collections |

从下午到午夜。259 个新测试。3 个只在真实 Minecraft 中才能发现的重大 bug。一次 Timer 重新设计。

大部分代码：由 Claude 编写，由我审查和调试。我越来越确信正确的心智模型是「Claude 是我打字比我快、永不疲倦的结对编程伙伴，但需要有人真正运行代码并告诉它哪里坏了。」模拟器和真实 Minecraft 之间的差距——只有在真实游戏中才会出现的 bug——完全是人类的问题。你需要真的玩这个游戏。

说实话，这没什么不好。用 Minecraft 调试编译器，是个相当不错的差事。

---

```bash
npm install -g redscript-mc@2.2.1
```

或者试试[在线 IDE](https://redscript-ide.pages.dev) — 无需安装。
