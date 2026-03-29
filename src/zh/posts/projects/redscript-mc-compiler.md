---
title: "RedScript：将类 C 语言编译为 Minecraft mcfunction"
description: "设计一个以 Minecraft Java 版数据包为编译目标的编译器——实体选择器作为第一等类型、foreach 循环降级为 execute 命令、@tick 装饰器生成软件计时器代码，以及一个完整的词法分析/解析/IR 流水线。"
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

Minecraft Java 版有一个出乎意料的强大脚本层。计分板充当整型寄存器，NBT 存储是任意的堆内存，`execute` 命令链就是条件分支。人们在游戏里构建了能工作的 CPU、光线追踪器和排序算法。但直接写这些代码非常痛苦——原始的 `.mcfunction` 文件没有变量、没有循环、没有抽象。

于是我构建了一个编译器。[bkmashiro/redscript](https://github.com/bkmashiro/redscript)

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

`@tick(rate=20)` 每秒运行一次该函数。`foreach` 迭代实体。`@on_trigger` 接通一个计分板触发器，让非管理员玩家可以通过 `/trigger claim_reward` 激活它。这会编译成一个可以直接拖进世界的有效 Minecraft 数据包。

## 设计决策

### 实体选择器作为第一等类型

在原版 mcfunction 中，`@e[type=zombie,distance=..5]` 只是嵌入在命令中的一个字符串片段，没有验证、没有补全、没有结构。

在 RedScript 中，它是一个真正的 AST 节点：

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

范围字面量（`..5`、`1..`、`1..10`）有自己的 token 类型。词法分析器通过检查 `@` 后面的字符是否是 `a/e/s/p/r/n` 加非字母来区分 `@a`（选择器）和 `@tick`（装饰器）。解析器将 `tag=!excluded` 否定处理为 `notTag`。这是未来类型检查和 IDE 工具支持的基础。

### foreach 必须将循环体提取为子函数

Minecraft 的 `execute` 命令只运行一条命令：

```
execute as @e[type=zombie] run <单条命令>
```

含多条语句的 foreach 循环体无法内联。降级通道检测到这种情况，将循环体提取为一个新的 `IRFunction`，命名为 `parent_fn/foreach_0`，然后在调用点生成 `execute as <selector> run function ns:parent_fn/foreach_0`：

```mcfunction
# check_zombies.mcfunction
execute as @e[type=zombie, distance=..10] run function rs:check_zombies/foreach_0

# check_zombies/foreach_0.mcfunction
kill @s
```

这一机制也适用于 `as (sel) { ... }` 和 `at (sel) { ... }` 块——任何需要 `execute ... run` 加多条命令的块都会被提升为子函数。

### 用 TAC 而非 SSA

我为 IR 选择了三地址码（TAC）而非 SSA。SSA 的主要优势是支持寄存器分配算法——但 Minecraft 计分板没有寄存器数量限制。假玩家分数实际上是无限的命名槽位，没什么好分配的。SSA 的复杂性开销在这里没有任何收益。

变量映射到计分板假玩家：

```
$x rs          → 变量 x
$t0 rs         → 临时槽位 0
$ret rs        → 返回值寄存器
$p0 rs, $p1 rs → 参数寄存器
```

所有在同一个 `rs` 目标中。IR 有显式的基本块和无条件/条件跳转，代码生成器将其转换为互相调用的独立 mcfunction 文件（因为 MC 没有 `goto`，每个基本块成为调用其后继者的函数）。

### @tick(rate=N) — 软件计时器

在 `minecraft:tick` 中注册函数会以 20Hz 运行。对于更低的频率，没有原生计时器——所以编译器生成一个计数器：

```mcfunction
# 注册到 minecraft:tick
scoreboard players add $__tick_slow_fn rs 1
execute if score $__tick_slow_fn rs matches 20.. run function rs:slow_fn
execute if score $__tick_slow_fn rs matches 20.. run scoreboard players set $__tick_slow_fn rs 0
```

`@tick(rate=20)` → 1Hz。`@tick(rate=200)` → 0.1Hz（每 10 秒一次）。计数器是每个函数独立的，命名方式避免冲突。

### 内建命令绕过 IR

用户定义的函数走完整流水线：降级 → 基本块 → 优化通道 → 代码生成。内建命令（`say`、`kill`、`give`、`effect`、`summon` 等）完全绕过它——它们是直接输出已知 MC 命令字符串的宏：

```ts
const BUILTINS = {
  say:    ([msg]) => `say ${msg}`,
  kill:   ([sel]) => `kill ${sel ?? '@s'}`,
  give:   ([sel, item, count]) => `give ${sel} ${item} ${count ?? 1}`,
  effect: ([sel, eff, dur, amp]) => `effect give ${sel} ${eff} ${dur} ${amp}`,
}
```

还有 `raw(cmd)` — 一个直接传到输出 `.mcfunction` 的字符串，用于编译器尚不支持的功能（复杂的 NBT 选择器等）。

## 完整流水线

```
.rs 源码
  → 词法分析    （选择器、范围、装饰器、关键字）
  → 解析        （递归下降，优先级爬升）
  → AST         （Program / FnDecl / Stmt / Expr）
  → 降级        （AST → TAC IR，子函数提取）
  → 优化        （常量折叠、死代码消除、拷贝传播）
  → 代码生成    （IR → mcfunction 文件树）
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

## 接下来

- `random(min, max)` → `/random value`（Java 1.21+），`execute store result`
- `entity.tag/untag/has_tag` — 通过 `/tag` 实现实体状态机
- `struct` 类型，由 NBT 存储支持
- `int[]` 数组，通过 `data modify storage ... append`
- `--target cmdblock` → 含物理脉冲/链式/循环命令方块布局的 `.nbt` 结构文件
- 世界对象：用隐形标记盔甲架作为类实例

最后一个——用盔甲架作为对象实例，搭配计分板字段——是我最感兴趣的特性。`let turret = spawn_object(x, y, z); turret.health -= 10;` 降级为 `execute as @e[tag=__rs_turret_0] run scoreboard players remove $health rs 10`。这是 Minecraft 里的面向对象编程。既荒诞又无可避免。
