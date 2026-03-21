---
title: "RedScript v3.0 — match 表达式、for-each 迭代与 stdlib 大扩充"
date: 2026-03-21
tags: [redscript, minecraft, compiler, gamedev]
description: "RedScript v3.0 带来了 match 模式匹配、for item in array 迭代语法，以及 state/dialog/scheduler 三个新 stdlib 模块，让 MC datapack 开发更简洁。"
---

# RedScript v3.0 — match 表达式、for-each 迭代与 stdlib 大扩充

RedScript v3.0 正式发布。这个版本专注于让代码写起来更自然——更少样板，更清晰的意图表达。

---

## match 表达式

告别冗长的 `if/else` 链。`match` 让分支逻辑一目了然：

```rs
match player_state {
    STATE_IDLE    => { start_walking(p) }
    STATE_WALKING => { check_destination(p) }
    STATE_COMBAT  => { update_combat(p) }
    _             => { }
}
```

通配符 `_` 处理所有未列出的情况，编译器会提示你是否遗漏了分支。

`match` 也支持括号写法，`match (v) { }` 和 `match v { }` 完全等价——选你喜欢的风格就好。

### Option 模式匹配

配合 `if let`，处理可能为空的值变得干净利落：

```rs
let opt: Option<int> = find_target(p)
if let Some(target_id) = opt {
    attack(p, target_id)
}
```

不再需要手动检查 `-1` 或魔法数字。

---

## for item in array

v3.0 支持直接迭代数组元素，不用再手写下标：

```rs
// 旧写法
for i in 0..items.len() {
    process(items[i])
}

// 新写法
for item in items {
    process(item)
}
```

更短，更不容易写错越界。

---

## 三个新 stdlib 模块

### state.mcrs — 玩家状态机

用整数给玩家绑定状态，状态存储由 stdlib 统一管理：

```rs
set_state(p, STATE_COMBAT)
let s: Option<int> = get_state(p)
```

`get_state` 返回 `Option<int>`，未设置时为 `None`，配合 `if let` 使用最顺手。

### dialog.mcrs — 对话与 UI

三行搞定副本开场提示：

```rs
dialog_say(p, "欢迎来到副本！")
dialog_title(p, "第一章", "迷失的城市")
dialog_actionbar(p, "§e血量: 100 / 100")
```

`dialog_say` 走聊天栏，`dialog_title` 走大标题+副标题，`dialog_actionbar` 走动作栏——MC 三种 UI 通道全覆盖。

### scheduler.mcrs — 延迟任务调度

不用再自己维护计时器 scoreboard：

```rs
task_schedule(p, 0, 100)  // 100 ticks 后触发任务 0

// 在 @tick 函数里检查
if (task_ready(p, 0) == 1) {
    spawn_boss(p)
}
```

每个玩家可以独立调度多个任务（用任务 ID 区分），`scheduler_tick()` 负责推进计时。

---

## 综合示例：副本开场

把上面三个模块拼在一起，一个带等待状态的副本开场只需要：

```rs
import "stdlib/state"
import "stdlib/dialog"
import "stdlib/scheduler"

const STATE_WAITING:  int = 0
const STATE_STARTING: int = 1
const STATE_ACTIVE:   int = 2

@on(PlayerJoin)
fn on_join(p: Player) {
    set_state(p, STATE_WAITING)
    dialog_title(p, "§6末日副本", "§7等待其他玩家...")
}

@tick
fn game_tick() {
    scheduler_tick()
}
```

玩家加入 → 设置等待状态 → 显示标题。后续可以在 `game_tick` 里检查人数，达到后用 `task_schedule` 倒计时开场，用 `match` 分发各阶段逻辑——完全无需额外的 scoreboard 脚手架。

---

## 升级指南

从 v2.x 升级到 v3.0 **无破坏性变更**，现有代码直接可用。新特性全部向后兼容：

- `match` 是纯增量语法，不影响现有 `if/else`
- `for item in arr` 是 `for i in 0..n` 的语法糖，两种写法并存
- 三个新 stdlib 模块按需 `import`，不引入则零开销

---

📖 完整文档：[redscript-docs.pages.dev](https://redscript-docs.pages.dev)
