---
title: "RedScript 2.0–2.2：从玩具到正经语言"
date: 2026-03-16
description: "一个下午到深夜的冲刺：枚举、泛型、Option<T>、LSP、协程、Source Map、增量编译——外加一堆只有在真实 Minecraft 服务器里才会暴露的 bug。"
readingTime: true
tag:
  - Minecraft
  - TypeScript
  - 编译器
  - RedScript
outline: [2, 3]
---

现在已经过了午夜，我刚推了 RedScript 2.2.1。测试数量从 877 涨到了 1136，版本号在同一天内从 2.0.0 跳到了 2.2.1。大部分代码是 Claude 写的，但真正把 datapack 塞进 Minecraft 服务器然后看它以各种有趣方式炸掉的，是我。

让我讲讲今天发生了什么。

- GitHub: [bkmashiro/redscript](https://github.com/bkmashiro/redscript)
- npm: [redscript-mc](https://www.npmjs.com/package/redscript-mc)
- 文档: [redscript-docs.pages.dev](https://redscript-docs.pages.dev)
- 在线 IDE: [redscript-ide.pages.dev](https://redscript-ide.pages.dev)

---

## 背景：RedScript 是什么？

RedScript 是一门类 TypeScript 的语言，编译目标是 Minecraft 数据包。它不跑在 JS 引擎里，而是编译成 `.mcfunction` 文件——用计分板做变量，用 NBT storage 做"内存"，用 MC 宏机制做动态分发，用 Minecraft 的命令执行模型做运行时。

```redscript
// 合法的 RedScript
function fibonacci(n: int): int {
  if (n <= 1) return n
  return fibonacci(n - 1) + fibonacci(n - 2)
}
```

```mcfunction
# 编译结果（简化版）
scoreboard players operation $a0 rs = $p0 rs
# ... 后面还有 40 行计分板算术
```

荒诞。好玩。能跑。1.x 系列证明了概念可行；2.x 是让它变成真正想用的东西。

---

## Phase 1–6：今天落地的语言特性

### 类型系统升级

**枚举（Enums）** — 真正的可辨识联合类型，不只是整数别名。编译器在编译期就知道所有变体，生成优化的计分板分支检查。

**泛型（Generics）** — `Stack<T>`、`List<T>`，编译期单态化。每种类型生成一份实例。是的，会有代码膨胀，但我现在不在乎。

**`Option<T>`** — `None` 用一个哨兵计分板值表示。`unwrap()` 在值为 None 时 panic（本质上是 `/kill @s`）。`map()` 和 `flatMap()` 生成你预期的分支 mcfunction 调用。

```redscript
// 之前：所有东西都可能静默地是垃圾值
function getBlock(pos: BlockPos): int {
  return readNBT(pos)  // 如果区块没加载可能是 undefined 😬
}

// 之后：显式表达"可能没有"
function getBlock(pos: BlockPos): Option<int> {
  if (!isChunkLoaded(pos)) return None
  return Some(readNBT(pos))
}
```

**TypeChecker 严格模式** — 之前的类型检查器……比较乐观。现在它会对隐式 `any`、缺少返回类型、不兼容数值类型之间的运算大喊大叫。

### 基础设施

**增量编译** — 在 manifest 中追踪文件哈希，未改动的文件不重新编译。中等规模项目的重建时间从 ~8s 降到 ~1s。

**Source Map** — 错误信息现在指向原始 `.mcrs` 文件和行号，而不是生成的 `.mcfunction`。听起来不起眼，但对调试来说是质的飞跃。

**LSP（语言服务器协议）** — 悬停类型提示、自动补全、跳转定义。你现在可以在 VS Code 里写 RedScript 并获得真正的智能提示。这是今天最大的用户体验提升。

### Minecraft 原生特性

**`@coroutine` 装饰器** — Minecraft 以 20 tick/秒运行。如果你的函数在一个 tick 里做了太多工作，服务器就会卡顿。`@coroutine` 包装函数，让它每 N tick 自动 yield，把工作分散到多个游戏周期。

```redscript
@coroutine(tickBudget: 5)
function processAllEntities(entities: Entity[]): void {
  for (const entity of entities) {
    heavyProcessing(entity)  // 每 5 tick 自动让出给 MC
  }
}
```

**`@schedule`** — 在函数上加 `@schedule(20)` 让它每 20 tick（一秒）执行一次。`schedule function ... 20t` 的语法糖。

**模块系统** — `import` / `export`，带正确的命名空间隔离。多个 `.mcrs` 文件现在可以共享类型和函数，而不会污染全局计分板命名空间。

### 工具链

**多版本目标** — `--target 1.20`、`--target 1.21`。不同 MC 版本的命令语法有变化，编译器现在会生成对应版本的语法。

**标准库 include path** — `import { Timer } from "stdlib/timer"` 直接能用，不再需要把标准库文件复制到每个项目里。

---

## 只有在真实 Minecraft 里才会出现的 Bug

关于测试 Minecraft 编译器，有一件事要说清楚：**模拟器是个谎言**。

不是恶意的谎言——它忠实地实现了*规范*。但真实的 Minecraft 服务器有各种规范里没有记录的怪癖。你只有在把 datapack 塞进 `world/datapacks/`，运行 `/reload`，然后盯着错误日志的时候才会发现。

### Bug 1：双空格

```mcfunction
execute  run function mypack:myfunction
```

发现了吗？`execute` 和 `run` 之间有**两个空格**。我的 IR 到 mcfunction 发射器里有这样一个模板字符串：

```typescript
// compiler/codegen/emit.ts
const cmd = `execute ${condition} run function ${fnName}`
```

当 `condition` 是空字符串（无条件 execute）时，就会生成 `execute  run function`——双空格。模拟器的命令解析器会修剪空白，所有单元测试都通过了。真实的 Minecraft 解析器不会。它直接返回 `Unknown command`，然后默默什么都不做。

在晚上 11 点盯着生成的 `.mcfunction` 文件想为什么条件块没有执行的时候发现的。

### Bug 2：BlockPos 坐标变成 `undefined`

```redscript
const pos: BlockPos = { x: 10, y: 64, z: -30 }
teleportTo(pos)
```

在模拟器里：正常。在 Minecraft 里：传送到 `10 undefined -30`。崩溃。

原因：BlockPos 被存储为三个独立的计分板值（`pos.x`、`pos.y`、`pos.z`）。结构体字段访问的代码生成有个 bug，负数字面量值没有被正确发射——它会发射字段名但不发射值赋值，让计分板槽位停留在之前的（未初始化的）值 `0`。不知为何，`0` 没有引发同样明显的崩溃……直到它引发了。

`undefined` 这个文本来自一个诊断辅助函数里的调试格式字符串，里面有 `score ?? 'undefined'`。修复是 emit 路径里的一行代码，*找到它*花了两个小时。

### Bug 3：Coroutine + Macro 函数的冲突

```redscript
@coroutine(tickBudget: 3)
function updateAll(list: Entity[]): void {
  for (const e of list) {
    process(e)  // process() 内部使用了 @macro
  }
}
```

`@coroutine` 包装器通过写入 NBT storage 来跨 tick 保存和恢复执行状态。`@macro` 装饰器让函数使用 MC 的 `$()` 宏替换进行动态分发。当两者组合时，宏上下文会被序列化进协程状态 NBT……但 Minecraft 处理宏复合数据的方式意味着重新调用时无法正确重建它。

修复方案：协程现在在挂起前急切地求值所有宏参数，恢复时传递具体值。损失了一些性能，但行为正确了。正确 > 快速。

### Bug 4：数组索引访问编译成 `const 0`

```redscript
function first<T>(arr: T[]): T {
  return arr[0]
}
```

`arr[0]` 的编译输出：

```mcfunction
# 期望：将 arr[0] 读入结果寄存器
# 实际：
scoreboard players set $result rs 0
```

泛型单态化 pass 在用具体类型替换 `T` 时忘记更新数组访问表达式节点了。索引表达式 `0` 被正确发射了，但*加载*指令丢失了——只剩下常量 `0` 作为一个空操作赋值。所有对 `first()` 的调用都返回 0，不管数组里有什么。

这个 bug 通过了全部 877 个单元测试，因为没有一个测试在严格模式下测试了带数组索引返回的泛型函数。新增了 47 个测试，修复了代码生成，现在是 1136 个。

---

## Timer 标准库：最有深度的部分

今天最有趣的技术工作是重新设计 `Timer` 标准库。

### 问题

在 JavaScript 里，你会这样写：

```typescript
const t = new Timer(1000, () => {
  console.log("tick!")
})
t.start()
```

在 Minecraft 里，没有堆，没有 `new`。有计分板（命名的整数槽）和 NBT storage（类 JSON 的 blob）。"对象"只是在这些平坦命名空间上的命名约定。

那怎么实现 `Timer`？

### 方案一：运行时全局计数器

在运行时用全局计数器计分板给每个定时器分配唯一 ID：

```mcfunction
# timer_create.mcfunction
scoreboard players add $timer_id_counter rs 1
scoreboard players operation $new_timer rs = $timer_id_counter rs
```

问题：调度的函数 `timer_N_tick.mcfunction` 在运行时不存在，它需要在编译时就存在。Minecraft 运行时无法生成新的函数文件。

### 方案二：编译期静态 ID 分配

编译器追踪每个模块里有多少定时器，并静态分配 ID：

```redscript
// 模块级：ID 在编译期分配 → timer_0, timer_1
const alertTimer = new Timer(20, () => {
  broadcastMessage("One second passed!")
})

const cleanupTimer = new Timer(100, () => {
  cleanupExpiredEntities()
})
```

编译器在编译时生成 `timer_0_tick.mcfunction` 和 `timer_1_tick.mcfunction`。ID 在编译间保持稳定（基于模块中的声明顺序）。

### Lambda 代码生成

Lambda `() => { broadcastMessage("One second passed!") }` 编译成：

```mcfunction
# timer_0_tick.mcfunction（自动生成）
function mypack:broadcast_message
# （带有 "One second passed!" 的参数设置）
```

`alertTimer.start()` 变成：

```mcfunction
schedule function mypack:timer_0_tick 20t
```

`alertTimer.stop()` 取消它：

```mcfunction
schedule clear mypack:timer_0_tick
```

### 硬约束

根本约束：**Timer 只能是模块级变量。** 你不能在循环里创建定时器：

```redscript
// 编译错误：Timer 不能在循环体内创建
for (const entity of entities) {
  const t = new Timer(5, () => cleanupEntity(entity))  // ❌
  t.start()
}
```

因为编译器需要生成无限多个 `timer_N_tick.mcfunction` 文件——每个 `entity` 一个，而 `entity` 是运行时数量。编译器在编译时捕获这个错误并告诉你改用 `@coroutine` 或 `@schedule`。

这是一个真实的约束，但它对平台诚实。Minecraft 数据包不是 JavaScript 运行时，假装它是会导致困惑。编译时大声失败比运行时静默失败要好得多。

---

## 数字对比

| 指标 | 之前 | 之后 |
|------|------|------|
| 版本 | 2.0.0 | 2.2.1 |
| 测试数量 | 877 | 1136 |
| 语言特性 | 枚举、基础泛型 | + Option\<T\>、严格 TypeChecker、协程、LSP、模块系统 |
| 标准库 | math、bigint | + timer、scheduler、collections |

从下午一直到深夜。259 个新测试。3 个只在真实 Minecraft 里才能发现的重大 bug。一次 Timer 架构重设计。

大部分代码：Claude 写的，我负责 review 和调试。我越来越觉得正确的心智模型是"Claude 是我的结对编程伙伴，打字比我快，从不累，但需要有人真正跑代码并告诉它什么崩了"。模拟器与真实服务器之间的差距——那些只在真实 Minecraft 里出现的 bug——仍然完全是人类的问题。你得真正玩这个游戏。

老实说，这挺好的。为了调试编译器而玩 Minecraft，这是个相当不错的工作。

---

```bash
npm install -g redscript-mc@2.2.1
```

或者直接试试[在线 IDE](https://redscript-ide.pages.dev)——无需安装。
