---
title: "RedScript v1.2：面向 Minecraft 数据包的强类型语言"
date: 2026-03-12
tags: [compiler, minecraft, typescript, programming-language]
description: "RedScript 是一门可编译到 Minecraft datapack 的强类型脚本语言。v1.2 带来了 OOP、事件系统、f-string 等关键能力。"
readingTime: true
tag:
  - 编译器
  - Minecraft
  - TypeScript
  - 编程语言
outline: [2, 3]
---

Minecraft datapack 很强大，但并不好写。scoreboard 像寄存器，`execute` 链像控制流，`function` 调用像基本块跳转。它足够强，可以写小游戏和服务器逻辑；但如果直接手写 `.mcfunction`，开发体验更像在拼装状态机，而不是在写程序。

RedScript 想解决的就是这个问题。它是一门会编译到 Minecraft datapack 的强类型语言，编译流程也更接近正常语言编译器，而不是简单命令模板展开。

- GitHub: [bkmashiro/redscript](https://github.com/bkmashiro/redscript)
- 文档: [redscript-docs.pages.dev](https://redscript-docs.pages.dev)
- 在线 IDE: [redscript-ide.pages.dev](https://redscript-ide.pages.dev)

先说明一个版本细节：`v1.2.0` 这个 tag 本身已经包含 `impl`、`@on(Event)`、定时器 API、`is` 类型收窄、namespace 前缀和标签常量这些核心特性；`f-string` 和 AST 层 DCE 则是在同一天、`v1.2.0` tag 之后立即合入 `main`。所以这篇文章写的是 v1.2 这一条产品线，而不是只盯着 tag 边界。

---

## Introduction

### 什么是 RedScript？

RedScript 是一门面向 Minecraft Java Edition datapack 的强类型脚本语言。你写的是结构体、函数、循环、装饰器和带类型的实体逻辑；编译器再把这些源码翻译成 Minecraft 实际执行的 datapack 文件树。

项目本身用 TypeScript 实现，npm 包名是 `redscript-mc`，还有 VSCode 扩展 `bkmashiro.redscript-vscode`，以及一个不用安装即可试用的在线 IDE。

### 为什么要给 Minecraft 写一个编译器？

因为 Minecraft 本身就像一个很怪但真实存在的虚拟机：

- scoreboard 是整数存储
- 实体选择器是动态查询表达式
- `execute ... run` 是控制流原语
- `minecraft:tick` 和 `minecraft:load` 这样的 datapack tag 是运行时入口

问题不在于它做不到，而在于它太难写。一个稍微复杂一点的游戏逻辑，很快就会膨胀成大量 helper function 和一堆样板命令。编译器的价值，就是让你先用正常语言写，再机械地降级回 datapack 模型。

---

## What's New in v1.2

### `impl` 块与 OOP 方法

`impl` 给结构体带来了方法语法。但它并不是引入一个复杂运行时对象系统，而是把方法当成普通函数的语法糖。像 `timer.tick()` 这样的实例方法调用，以及 `Timer::new(20)` 这样的静态调用，都会被干净地降低成带前缀的普通函数。

### 基于 `@on` 的静态事件系统

RedScript 现在支持静态事件层：

```rs
@on(PlayerDeath)
fn handle_death(player: Player) {
    say("player died");
}
```

编译器会校验事件名和参数签名，然后把 handler 接到一个逐 tick 运行的 dispatcher 上，扫描 `rs.just_died` 这类事件 tag。

### 面向运行时输出的 f-string

富文本输出终于更自然了：

```rs
tellraw(@a, f"Score: {score}");
actionbar(@s, f"Time left: {time}");
```

RedScript 不会过早把它拼成普通字符串，而是把它编译成 `tellraw` / `title` 所需的 JSON component，这样整数仍然可以在运行时以 scoreboard 值的形式显示。

### 用 `is` 做类型收窄

实体类型不再只是字符串。像 `if (e is Player)` 这样的检查会直接反馈给类型检查器和 lowering 流程，让控制流里的实体类型真正收窄，并映射成 Minecraft 可执行的选择器判断。

### Timer API 与 `setTimeout` / `setInterval`

标准库新增了 OOP 风格的 `Timer` API，语言层新增了 `setTimeout`、`setInterval` 和 `clearInterval`。这组能力和 Minecraft 很搭，因为原版本来就有 `schedule function`；编译器要做的，是自动生成正确的 helper function 和调度代码。

### Dead code elimination

编译器现在会移除不可达函数、未使用常量、常量条件下的死分支，以及 AST 中未被读取的局部声明。对 datapack 编译器来说，这不是纸面优化，而是直接减少生成的 `.mcfunction` 文件和命令数量。

### 313 个 MC 标签常量

标准库现在内置了 `313` 个自动生成的 Minecraft tag 常量，覆盖 block、entity、item、fluid 和 damage 分类。用户代码不需要一遍遍手写 `#minecraft:...` 字符串，可以直接用 `BLOCK_LOGS`、`ENTITY_SKELETONS` 这类常量。

---

## Technical Highlights

### 编译流水线

核心流水线现在是：

```text
Source
  -> Lexer
  -> Parser
  -> TypeChecker
  -> Lowering
  -> CodeGen
```

实际上 lowering 和最终输出之间还有优化阶段，但关键点在于：RedScript 不是一个命令模板引擎，它有真实的前端、类型化 AST 和明确的 lowering 阶段。

### `impl` 块如何编译成前缀函数

`impl` 不会保留为运行时概念。lowering 会把：

```rs
impl Counter {
    fn inc(self, n: int) {}
}
```

改写成普通函数名：

```text
Counter_inc(self, n)
```

这样后端根本不用理解“面向对象”，只要继续处理普通函数、参数寄存器和 scoreboard 变量即可。

### 事件如何编译成 tick dispatcher

`@on(PlayerDeath)` 会在 lowering 阶段挂到函数元数据上，随后 codegen 在 `__tick.mcfunction` 里输出类似这样的分发逻辑：

```mcfunction
execute as @a[tag=rs.just_died] run function ns:handle_death
tag @a[tag=rs.just_died] remove rs.just_died
```

这个模型非常朴素，但也非常稳：事件是静态注册的，分发逻辑在生成结果里一眼可见，调试也简单。

### f-string 如何编译成 `tellraw` JSON

对于 `say`、`tellraw`、`actionbar`、`title` 这些输出内建函数，f-string 会被拆成文本片段和表达式片段。文本变成 `{"text":"..."}`，整型表达式变成 scoreboard component：

```json
["", {"text":"Score: "}, {"score":{"name":"$score","objective":"rs"}}]
```

也就是说，编译器实际上是在直接生成 Minecraft 富文本 AST，而不是提前把所有东西压平成普通字符串。

### DCE 算法：从入口点开始的标记-清除

AST 层的 dead code elimination 基本就是经典 mark-sweep：

1. 找到入口点，例如 `main`、`@tick`、`@load`、`@on(...)` 以及 trigger/advancement handler。
2. 从这些根节点出发遍历调用图，标记可达函数。
3. 跟踪哪些常量和局部声明真的被读取。
4. 清扫其余内容。

对 datapack 编译器来说，这个优化尤其值钱，因为未使用函数不是抽象浪费，而是真正多出来的文件和命令。

---

## Code Examples

### `impl` 方法调用

RedScript：

```rs
struct Timer {
    _id: int,
    _duration: int
}

impl Timer {
    fn new(duration: int) -> Timer {
        return { _id: 0, _duration: duration };
    }

    fn done(self) -> bool {
        return self._duration <= 0;
    }
}

fn test() -> bool {
    let timer: Timer = Timer::new(20);
    return timer.done();
}
```

Lowered call 形态：

```text
call Timer_new(20)
call Timer_done(timer)
```

生成出来的 mcfunction 形态：

```mcfunction
scoreboard players set $p0 rs 20
function redscript:Timer_new
scoreboard players operation $timer rs = $ret rs
scoreboard players operation $p0 rs = $timer rs
function redscript:Timer_done
```

### 静态事件

RedScript：

```rs
@on(PlayerDeath)
fn handle_death(player: Player) {
    scoreboard_add(#event_test, #death_count, 1);
}
```

生成的 dispatcher：

```mcfunction
execute as @a[tag=rs.just_died] run function redscript:handle_death
tag @a[tag=rs.just_died] remove rs.just_died
```

而在 handler 内部，`player` 会被降级成 `@s`，因为 dispatcher 本身已经切换到匹配到的玩家上下文执行。

### f-string

RedScript：

```rs
fn test() {
    let score: int = 7;
    tellraw(@a, f"Score: {score}");
}
```

生成命令：

```mcfunction
tellraw @a ["",{"text":"Score: "},{"score":{"name":"$score","objective":"rs"}}]
```

这很好地说明了编译器的价值：一个看似普通的字符串插值特性，最终被准确映射成 Minecraft 富文本输出格式。

---

## Performance & Stats

目前仓库里可以直接看到两组明确数据：

- README badge 显示 `510 passing` tests
- 标准库包含 `313` 个自动生成的 Minecraft tag 常量

另外，优化器可以通过 `redscript compile --stats` 输出详细统计，包括：

- LICM hoist 次数
- 公共子表达式消除次数
- `setblock` 合并成 `fill` 的批处理统计
- 删除的死命令数
- 常量折叠次数
- 优化前后总命令数

README 里的示例展示了一次从 `34` 条命令降到 `28` 条的输出，约 `18%` 缩减。这正是 DCE 和命令级优化在这个领域应该带来的收益：更小的 datapack、更少的 helper file，以及更少的 scoreboard 噪音。

---

## Future Plans

当前事件系统是刻意做成静态的。未来当然可以做动态订阅/反订阅，但那会要求更重的运行时状态模型，以及更复杂的 dispatcher。

实体类型系统也还有很大空间。现在已经能支持 `e is Player` 这种检查和 Minecraft-aware 的参数校验，但未来仍然可以往更细的实体层级、更强的 selector 感知 API 继续扩展。

第三个明显方向是 IDE 体验。现在已经有 VSCode 扩展和在线 IDE，但编译器架构已经成熟到足以支持更强的 diagnostics、更好的 hover/type 信息，以及更积极的编译期反馈。

---

## Links

- GitHub: [https://github.com/bkmashiro/redscript](https://github.com/bkmashiro/redscript)
- 文档: [https://redscript-docs.pages.dev](https://redscript-docs.pages.dev)
- 在线 IDE: [https://redscript-ide.pages.dev](https://redscript-ide.pages.dev)
- npm: `redscript-mc`
- VSCode: `bkmashiro.redscript-vscode`
