---
title: "用 RedScript 写 Minecraft 游戏的设计模式"
date: 2026-03-22
tags: [redscript, minecraft, gamedev, patterns]
description: "结合 RedScript examples/ 与 stdlib，梳理状态机、ECS、事件驱动、scheduler 与 singleton 全局状态在 datapack 游戏里的落法。"
readingTime: true
tag:
  - RedScript
  - Minecraft
  - GameDev
  - Design Patterns
outline: [2, 3]
---

Minecraft datapack 开发最麻烦的地方，不是语法，而是“怎么把游戏逻辑压进 tick、scoreboard、NBT 和 function 文件树”。RedScript 的价值，恰好在于它已经把一些经典游戏模式变成了可直接落地的代码结构。翻 `../redscript/examples/`，能看到几种非常稳定的写法。

## 1. 状态机：最适合先学的模式

`examples/enum-demo.mcrs` 是最标准的教材。它定义 `enum Phase { Idle, Moving, Attacking }`，再用一个 `NpcState` 结构保存 `phase`、`ticks`、`active`，最后在 `@tick fn npc_tick()` 里 `match npc.phase` 分发到 `phase_idle()`、`phase_moving()`、`phase_attacking()`。这种写法的好处有三个：状态是显式值；转移条件集中；每个状态处理函数都很短。

同样的思路在 `examples/rpg/health_system.mcrs` 和 `examples/rpg/boss_fight.mcrs` 里更明显。前者用 `PlayerStatus` 表示 `Alive/Wounded/Dead`，后者用 `BossPhase` 管三阶段 boss 战。对 datapack 来说，状态机几乎是第一原则，因为 tick 是离散推进的，任何“阶段性”玩法都应该先落成枚举和转移，而不是散在几十个布尔 flag 里。

## 2. ECS：当 struct 开始变多时，别再硬堆字段

`src/stdlib/ecs.mcrs` 提供的是一套轻量 ECS 思路：组件状态用 `int[]` 表示，presence 用 tag 表示，整数字段放 scoreboard。比如 health 组件布局里 `[1]` 是当前 HP、`[2]` 是最大 HP，velocity 组件则把 `vx/vy/vz` 存在固定槽位。它不追求 OO 的“对象方法”，而是强调数据布局和批处理。

有意思的是，examples 里的 `tower_defense.mcrs` 和 `racing.mcrs` 还主要是“手写 struct 状态”风格：`Tower`、`WaveState`、`TDState`、`RaceState` 都是直接建模。这种写法在规模小时很好读，但当实体种类、可选属性和系统数量变多时，就会开始往 ECS 靠。也就是说，examples 展示了从“结构化状态”到“组件化状态”的演进路径，而 `ecs.mcrs` 给了你继续扩张时的落点。

## 3. 事件驱动：别让所有逻辑都塞进 `@tick`

`src/stdlib/events.mcrs` 的实现很直接：在 `@tick` 中轮询 `deathCount`、`totalKillCount`、加入标签等信号，再分发到 `#rs:on_player_join`、`#rs:on_player_death` 这类函数 tag。类型层面，`src/events/types.ts` 还给 `PlayerJoin`、`PlayerDeath`、`EntityKill`、`ItemUse` 约束了 handler 参数。

这套模式的重点不是“完全摆脱轮询”，而是把轮询封装成事件接口。对游戏逻辑作者来说，写 `@on(PlayerDeath)` 比自己维护十几个 scoreboard objective 更可控。实际项目里，推荐把状态推进、掉落、成就、UI 提示这些天然异步的逻辑都挂到事件入口，而不是让一个巨大的 `game_tick()` 什么都做。

## 4. scheduler：把“未来某个 tick 再做”显式化

RedScript 里有两类 scheduler。`examples/scheduler-demo.mcrs` 展示的是 `@schedule(ticks=20)` 这种编译器级延迟调用，生成 `_schedule_xxx` 包装器后直接发 `schedule function`。它适合“一次性未来任务”，比如 1 秒后开奖励、5 秒后切白天、链式触发第二阶段。

另一类是 `src/stdlib/scheduler.mcrs` 的 scoreboard scheduler。它提供 `task_schedule`、`task_ready`、`scheduler_tick`，把 8 个玩家槽位和 8 个全局槽位当倒计时器。这个版本更适合持续性系统，比如技能冷却、波次间隔、Boss 技能循环。`tower_defense` 里目前还是手搓 `spawn_timer` 和 `tick % 60`，但如果任务数继续增加，迁到 scheduler 模式会更稳。

## 5. singleton：当游戏有“世界级状态”时

虽然 examples 大多还是普通全局 `let` 或单个 struct 变量，但从语言能力上看，`@singleton` 才是更明确的“全局状态模式”。测试显示它会给 struct 合成 `Type::get()` / `Type::set()`，字段再落到独立 scoreboard objective。这个模式很适合大厅状态、全服倒计时、当前关卡、匹配队列等只有一份实例的数据。

如果把 `enum-demo` 的 `npc`、`boss_fight` 的 `boss`、`tower_defense` 的 `td` 和 `wave` 进一步收口，一个自然方向就是把这些“全局唯一状态”改成 singleton struct，而把玩家或实体私有状态继续留在 selector/scoreboard 或 ECS 组件里。这样边界会更清晰：单例管世界，ECS 管实体，状态机管阶段，scheduler 管时间。

## 结语

用 RedScript 写 Minecraft 游戏，最重要的不是背 API，而是先选对模式。小型玩法先用状态机；实体变多时转向 ECS；异步触发用事件驱动；跨 tick 的未来动作交给 scheduler；只有一份的世界状态收进 singleton。`examples/` 里这些写法已经说明了一件事：哪怕目标平台只是 datapack，只要模式选对，代码仍然可以像一门正经游戏语言，而不是一堆难以维护的命令脚本。
