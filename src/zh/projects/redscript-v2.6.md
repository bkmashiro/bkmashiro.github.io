---
title: "RedScript 2.6：stdlib 扩展、事件系统与 MC 集成测试"
date: 2026-03-20
description: "一个下午把 RedScript 的 stdlib 从基础数学扩展到图算法、数值 ODE、线性代数、FFT、ECS——然后给 Minecraft 加上了事件系统，最终在真实服务器上跑通了 PlayerJoin 和 PlayerDeath 集成测试。"
readingTime: true
tag:
  - RedScript
  - Minecraft
  - 编译器
  - 算法
  - TypeScript
outline: [2, 3]
---

今天我给 RedScript 的标准库一口气加了五个模块，然后做了一件之前一直拖着没做的事：给 Minecraft 加上了事件系统。

- GitHub: [bkmashiro/redscript](https://github.com/bkmashiro/redscript)

---

## stdlib 大扩展

RedScript 一直有基础的数学库，但缺少更复杂的算法支持。v2.6 一次补上了五个模块。

### graph.mcrs — 邻接表 + 图算法

Minecraft 里的玩家/实体关系天然是图结构。`graph.mcrs` 实现了：

- 邻接表（用 scoreboard 模拟）
- BFS / DFS 遍历
- Dijkstra 最短路径

在记分板整数运算的约束下实现 Dijkstra 是有意思的——没有浮点数，所有权重必须是整数，但基本思路是一样的。

### ode.mcrs — RK4 数值积分

一个用 RedScript 写的 [Runge-Kutta 四阶](https://en.wikipedia.org/wiki/Runge%E2%80%93Kutta_methods) ODE 求解器。初看可能觉得奇怪：Minecraft 里为什么要解微分方程？

实际上有用途：物理模拟（弹道、抛体）、流体近似、经济模型。记分板精度有限，所以这是定点数 RK4，但在这个约束下精度已经够用。

### linalg.mcrs — 向量、矩阵、Cramer 法则

double 精度（实际是定点数放大）的线性代数库：

```redscript
let v1: Vec3 = Vec3(1, 2, 3);
let v2: Vec3 = Vec3(4, 5, 6);
let dot: int = dot(v1, v2);   // 32
let cross: Vec3 = cross(v1, v2);
```

矩阵求逆用 Cramer 法则实现——对于 Minecraft 的精度要求，3×3 矩阵够用了。

调试过程中遇到了一个有趣的 cast bug：整数到定点数的隐式转换在某些边界情况下会溢出。修了一个上午。

### fft.mcrs — DFT + @coroutine

离散傅里叶变换，用 `@coroutine` 装饰器分帧执行。

这里的难点是三角函数。Minecraft 没有原生 sin/cos，所以：

1. 编译时预计算 sin/cos 查找表（LUT），填入 NBT storage `math:tables`
2. 运行时查表，插值精度够用

`@coroutine` 把 DFT 的每个频率分量拆到独立的游戏 tick 里执行，避免单帧超时。

```redscript
@coroutine
fn compute_spectrum(signal: int[]) {
    // 自动分帧，不会卡服务器
    ...
}
```

初始测试时发现 DC 分量始终为 0，追查后发现角度计算里 `3600000` 写成了 `360`——LUT 的精度问题。改了两处就过了。

### ecs.mcrs — Entity Component System

一个轻量 ECS 框架，用 scoreboard 模拟 component storage：

```redscript
@component
struct Health { value: int; }

@component
struct Speed { value: int; }

@system
fn move_system(e: Entity) {
    if has_component(e, Speed) {
        // ...
    }
}
```

Entity ID 用 scoreboard 存储，component 数据挂在对应实体的分数上。`@system` 装饰器生成遍历逻辑。

---

## 事件系统：@on(EventType)

这是 v2.6 最重要的新特性。

以前 RedScript 没有办法响应游戏事件（玩家加入、死亡、方块破坏……）。这次加了一个编译时静态注册的事件系统：

```redscript
@on(PlayerJoin)
fn greet(p: Player) {
    tellraw(p, "欢迎！");
    rs.joined += 1;
}

@on(PlayerDeath)
fn on_death(p: Player) {
    rs.deaths += 1;
}
```

架构：

- `@on(EventType)` 在编译时静态注册 handler
- 生成 `events.mcrs` — 每 tick 轮询 dispatch
- Minecraft 原生 advancement 机制触发事件（如 `minecraft:adventure/root` 检测加入）

### BlockBreak 的设计取舍

最初设计 `BlockBreak(p: Player, blockType: BlockType)` 双参数，但 Minecraft 没有办法在运行时把被破坏的方块类型传进 mcfunction。最终改成了 `(p: Player)` 单参数——如果需要统计特定方块，用 scoreboard 预先记录。

### MC 集成测试

为了验证事件系统，我在本地 Minecraft 服务器（`~/mc-test-server`）上跑了集成测试：

1. 服务器启动，加载 datapack
2. 玩家加入 → `rs.joined` scoreboard +1
3. 玩家死亡 → `rs.deaths` scoreboard +1
4. 读取 scoreboard 验证数值

调试过程中发现了一个 `scoreboard_get/set` 的 Player 参数 bug：`exprToCommandArg` 里 ident 变量 fallback 没有正确指向 `@s`，导致生成的命令目标不对。修完后 440 个测试全绿。

---

## 感想

今天最有意思的不是哪个算法，而是**在 Minecraft 的约束下设计 API**。没有浮点数、没有动态数组、没有递归（超过调用链限制会卡死服务器）——每个语言特性都要想清楚它会编译成什么命令。

ECS 的 component 存 scoreboard、FFT 的三角函数查表、ODE 的定点数……这些设计限制反而有种奇特的美感。

v2.6 的完整更新日志在 [CHANGELOG.md](https://github.com/bkmashiro/redscript/blob/master/CHANGELOG.md)。
