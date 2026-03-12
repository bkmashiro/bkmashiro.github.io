---
title: "RedScript：把类 C 语言编译成 Minecraft mcfunction"
description: "设计一个以 Minecraft Java 版数据包为目标的编译器——实体选择器作为一等类型、foreach 循环降低为 execute 命令、@tick 装饰器生成软件定时器代码，以及在一个 session 中完成的完整 Lexer/Parser/IR 流水线。"
date: 2026-03-12
readingTime: true
tag:
  - 编译器
  - Minecraft
  - TypeScript
  - 语言设计
  - IR
outline: [2, 3]
---

Minecraft Java 版有一套出人意料的强大脚本层。记分板可以当作整数寄存器。NBT 存储是任意堆内存。`execute` 命令链就是条件分支。有人在游戏里造出了可工作的 CPU、光追渲染器和排序算法。但直接写这些代码是痛苦的——原始的 `.mcfunction` 文件没有变量、没有循环、没有抽象。

所以我造了一个编译器。[bkmashiro/redscript](https://github.com/bkmashiro/redscript)

## 它长什么样

```c
@tick(rate=20)
fn check_zombies() {
    foreach (z in @e[type=zombie, distance=..10]) {
        kill(z);
    }
}

@on_trigger("claim_reward")
fn handle_claim() {
    give(@s, "minecraft:diamond", 1);
    title(@s, "Zombie Slayer!");
}
```

`@tick(rate=20)` 让函数每秒运行一次。`foreach` 遍历实体。`@on_trigger` 连接一个记分板触发器，让非 OP 玩家可以用 `/trigger claim_reward` 激活它。这会编译成一个有效的 Minecraft 数据包，你可以直接扔进你的世界。

## 设计决策

### 实体选择器作为一等类型

在原版 mcfunction 中，`@e[type=zombie,distance=..5]` 只是嵌入命令中的字符串片段。没有验证、没有补全、没有结构。

在 RedScript 中，它是一个合适的 AST 节点：

```ts
interface EntitySelector {
  kind: '@a' | '@e' | '@s' | '@p' | '@r' | '@n'
  filters?: {
    type?: string
    distance?: RangeExpr     // ..5, 1.., 1..10
    tag?: string[]
    notTag?: string[]        // tag=!excluded
    scores?: Record<string, RangeExpr>
    limit?: number
    sort?: 'nearest' | 'furthest' | 'random' | 'arbitrary'
    nbt?: string
  }
}
```

范围字面量（`..5`、`1..`、`1..10`）是独立的 token 类型。词法分析器通过检查 `@` 后面的字符是否是 `a/e/s/p/r/n` 之一且后面不是字母来区分 `@a`（选择器）和 `@tick`（装饰器）。解析器将 `tag=!excluded` 的否定形式处理为 `notTag`。这是未来类型检查和 IDE 工具的基础。

### foreach 必须将函数体提取为子函数

Minecraft 的 `execute` 命令只执行一条命令：

```
execute as @e[type=zombie] run <单条命令>
```

包含多条语句的 foreach 函数体无法内联。降低（lowering）阶段检测到这种情况，会将函数体提取为一个名为 `parent_fn/foreach_0` 的新 `IRFunction`，然后在调用点生成原始的 `execute as <selector> run function ns:parent_fn/foreach_0`：

```mcfunction
# check_zombies.mcfunction
execute as @e[type=zombie, distance=..10] run function rs:check_zombies/foreach_0

# check_zombies/foreach_0.mcfunction
kill @s
```

这也适用于 `as (sel) { ... }` 和 `at (sel) { ... }` 块——任何需要 `execute ... run` 且后面有多条命令的块都会被提升为子函数。

### TAC 而非 SSA

我选择三地址码（TAC）作为 IR，而不是 SSA。SSA 的主要优势是启用寄存器分配算法——但 Minecraft 记分板没有寄存器限制。假玩家分数实际上是无限的命名槽位。没什么需要分配的。SSA 的复杂性成本在这里买不到任何东西。

变量映射到记分板假玩家：

```
$x rs          → 变量 x
$t0 rs         → 临时槽位 0
$ret rs        → 返回值寄存器
$p0 rs, $p1 rs → 参数寄存器
```

全部在同一个 `rs` 目标中。IR 有显式的基本块和无条件/条件跳转，代码生成器将其转换为相互调用的独立 mcfunction 文件（因为 MC 没有 `goto`，每个基本块变成一个调用其后继的函数）。

### @tick(rate=N) — 软件定时器

将函数注册到 `minecraft:tick` 会让它以 20Hz 每游戏刻运行一次。对于更低的频率，没有原生定时器——所以编译器生成一个计数器：

```mcfunction
# 注册到 minecraft:tick
scoreboard players add $__tick_slow_fn rs 1
execute if score $__tick_slow_fn rs matches 20.. run function rs:slow_fn
execute if score $__tick_slow_fn rs matches 20.. run scoreboard players set $__tick_slow_fn rs 0
```

`@tick(rate=20)` → 1Hz。`@tick(rate=200)` → 0.1Hz（每 10 秒）。计数器是每个函数独立的，命名以避免冲突。

### 内置函数绕过 IR

用户定义的函数走完整流水线：降低 → 基本块 → 优化 passes → 代码生成。内置命令（`say`、`kill`、`give`、`effect`、`summon` 等）完全绕过它——它们是直接生成已知 MC 命令字符串的宏：

```ts
const BUILTINS = {
  say:    ([msg]) => `say ${msg}`,
  kill:   ([sel]) => `kill ${sel ?? '@s'}`,
  give:   ([sel, item, count]) => `give ${sel} ${item} ${count ?? 1}`,
  effect: ([sel, eff, dur, amp]) => `effect give ${sel} ${eff} ${dur} ${amp}`,
}
```

还有 `raw(cmd)`——一个直接传递到输出 `.mcfunction` 的字符串。用于编译器还不支持的情况（复杂 NBT 选择器等）。

### /trigger — 非 OP 玩家输入

通常，玩家不能修改自己的记分板分数。`trigger` 类型的目标是例外：服务器可以为每个玩家 `enable` 它们，然后该玩家可以运行 `/trigger <name>` 来增加他们的分数（之后会自动禁用，直到服务器重新启用）。

这是唯一不授予 OP 权限就能实现玩家→数据包通信的官方渠道。商店、菜单、请求按钮——任何需要玩家输入的东西——都通过 trigger。

```c
@on_trigger("open_shop")
fn handle_shop() {
    give(@s, "minecraft:bread", 3);
    tell(@s, "Here's your bread.");
}
```

生成的输出：
- `load.mcfunction`：`scoreboard objectives add open_shop trigger` + `scoreboard players enable @a open_shop`
- 每刻检查：`execute as @a[scores={open_shop=1..}] run function rs:__trigger_open_shop_dispatch`
- 分发：调用处理器 → 重置分数 → 为该玩家重新启用

程序员只需写 `@on_trigger`，编译器处理所有样板代码。

## 完整流水线

```
.rs 源代码
  → Lexer         (选择器、范围、装饰器、关键字)
  → Parser        (递归下降、优先级爬升)
  → AST           (Program / FnDecl / Stmt / Expr)
  → Lowering      (AST → TAC IR, 子函数提取)
  → Optimizer     (常量折叠、死代码消除、复制传播)
  → Codegen       (IR → mcfunction 文件树)
  → datapack/
```

191 个测试，7 个套件，全部通过。

## CLI

```bash
redscript compile src/main.rs -o dist/mypack/
redscript compile src/main.rs --namespace mypack
redscript check src/main.rs      # 类型检查，不写文件
redscript version
```

## 下一步

- `random(min, max)` → `/random value`（Java 1.21+），`execute store result`
- `entity.tag/untag/has_tag` — 通过 `/tag` 实现实体状态机
- NBT 存储支持的 `struct` 类型
- 通过 `data modify storage ... append` 实现 `int[]` 数组
- `--target cmdblock` → 带有物理脉冲/连锁/循环方块布局的 `.nbt` 结构文件
- 世界对象：使用隐形标记盔甲架作为类实例

最后一个——使用盔甲架作为具有记分板字段的对象实例——是我最感兴趣的功能。`let turret = spawn_object(x, y, z); turret.health -= 10;` 降低为 `execute as @e[tag=__rs_turret_0] run scoreboard players remove $health rs 10`。这是 Minecraft 内的 OOP。既诡异又不可避免。
