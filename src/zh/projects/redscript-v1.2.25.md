---
title: "RedScript v1.2.25：实体类型系统、变量混淆与 CI 自动化"
date: 2026-03-14
tags: [编译器, minecraft, typescript, 编程语言]
description: "实体类型层级与 W_IMPOSSIBLE_AS 警告、is T 类型收窄、selector<T> 注解、积分榜变量混淆（$a $b $c...）、sourcemap、以及完整的 CI/CD 流水线。"
readingTime: true
tag:
  - 编译器
  - Minecraft
  - TypeScript
  - 编程语言
outline: [2, 3]
---

一天做了很多事。这篇文章记录 2026 年 3 月 13 日 RedScript 的工作——从实体类型安全到 CI/CD 自动化。

- GitHub: [bkmashiro/redscript](https://github.com/bkmashiro/redscript)
- npm: [redscript-mc](https://www.npmjs.com/package/redscript-mc)
- 文档: [redscript-docs.pages.dev](https://redscript-docs.pages.dev)
- 在线 IDE: [redscript-ide.pages.dev](https://redscript-ide.pages.dev)

---

## 实体类型系统

最大的新功能：基于 Minecraft 实体注册表建模的编译期实体类型层级。

```
Entity（基类，抽象）
├── Player
├── Mob（抽象）
│   ├── HostileMob（抽象）
│   │   ├── Zombie, Skeleton, Creeper, Spider, Enderman, ...
│   └── PassiveMob（抽象）
│       ├── Pig, Cow, Sheep, Chicken, Villager, ...
├── ArmorStand
├── Item
└── Arrow
```

### W_IMPOSSIBLE_AS

编译器现在能在编译期检测出不可能的类型断言。如果当前上下文是玩家，却要切换成僵尸，那个块永远不会执行——编译器会警告你：

```rs
foreach (p in @a) {
    // @s 是 Player

    as @e[type=zombie] {
        // W_IMPOSSIBLE_AS：@s 是 Player，但目标是 Zombie
        // Player ≠ Zombie（不在同一继承链上）→ 这里永远不会运行
        kill(@s);
    }
}
```

规则：在已知 `@s` 为某类型的上下文中，`as @e[type=X]` 指向一个不兼容的类型，触发 `W_IMPOSSIBLE_AS`。代码仍然正常编译（警告不阻断编译），但你知道这里有逻辑问题。

### 上下文感知的 @s

编译器在程序的每个位置都追踪 `@s` 的类型：

```rs
foreach (p in @a) {
    // @s: Player

    as @e[type=armor_stand] {
        // @s: ArmorStand

        as @e[type=zombie] {
            // @s: Zombie
        }

        // @s: ArmorStand（恢复）
    }

    // @s: Player（恢复）
}
```

上下文通过栈来管理，进入 `as` 块时 push，离开时 pop。

### `is T` 类型收窄

```rs
foreach (e in @e) {
    if (e is Player) {
        give(@s, "diamond", 1);  // ✅ @s 在这里是 Player
    }
    if (e is Zombie) {
        kill(@s);                // ✅ @s 在这里是 Zombie
    }
}
```

编译成 Minecraft 实体类型检查：

```mcfunction
# 具体类型 → 单条检查
execute if entity @s[type=minecraft:zombie] run function ns:branch

# 抽象类型（如 HostileMob）→ 展开为所有具体子类型的 OR 检查
scoreboard players set __is_result rs:temp 0
execute if entity @s[type=minecraft:zombie] run scoreboard players set __is_result rs:temp 1
execute if entity @s[type=minecraft:skeleton] run scoreboard players set __is_result rs:temp 1
execute if entity @s[type=minecraft:creeper] run scoreboard players set __is_result rs:temp 1
# ... 所有 hostile mob
execute if score __is_result rs:temp matches 1 run function ns:branch
```

### `selector<T>` 类型注解

函数参数现在可以标注具体的实体类型：

```rs
fn buff(targets: selector<Player>) { ... }       // 只接受玩家
fn killMobs(targets: selector<Mob>) { ... }      // 接受任何 Mob 子类
fn doAnything(e: selector<Entity>) { ... }       // 接受所有实体
```

类型系统是协变的：`selector<Zombie>` 可以传给需要 `selector<Mob>` 的参数，因为 `Zombie extends Mob`。

---

## 变量名混淆

之前，RedScript 将 `let counter: int = 0` 编译成名为 `$counter` 的积分榜变量。这意味着用户变量可能与编译器生成的名字冲突，比如 `$const_0`、`$p0`、`$ret`。

现在编译器使用顺序分配器——和 JS 压缩工具 Terser 的做法一样：

```
counter  →  $a
running  →  $b
常量 0   →  $c
常量 1   →  $d
常量 20  →  $e
__ret    →  $f
```

**零碰撞风险。** 分配器从共享池按顺序分配名字（`a, b, c, ..., z, aa, ab, ...`），相同变量总是得到相同名字。

### `--no-mangle` 调试模式

```bash
redscript compile main.mcrs --no-mangle
```

生成可读名字：`$rs_counter`、`$rs_running`、`$__c_0` 等。在游戏内用 `/scoreboard players list` 检查变量值时很有用。

### Sourcemap

混淆模式（默认）下，编译器会在 datapack 旁边生成一个 `.map.json`：

```json
{
  "$a": "counter",
  "$b": "running",
  "$c": "const:0",
  "$d": "const:1",
  "$f": "internal:ret"
}
```

编译器生成的临时变量（`_0`、`_1`，SSA 中间值）被过滤掉，只有用户可见的变量出现在 map 中。

---

## 其他修复

**`__load` 中常量去重：** 之前，如果多个函数都用了常量 `1`，`__load` 函数里会出现多次 `scoreboard players set $const_1 rs 1`（每个函数一次）。现在先跨所有函数收集常量，去重后只生成一次。

**空的续体块：** 某些 `if/else` 分支会生成只包含注释（`# block: then_0`）的 `.mcfunction` 文件，没有实际命令。现在这类空块直接跳过，不再生成文件。

---

## CI/CD 自动化

完整的发布流水线现在完全自动化：

```
git push to main
    ↓
CI 跑测试（684 个通过）
    ↓ 成功
Publish workflow 触发
    ↓
1. bump VSCode 扩展版本 → commit → push
2. npm publish redscript-mc（已发布则跳过）
3. vsce publish VSCode 扩展
4. repository_dispatch → redscript-ide
              ↓
        update-compiler.yml
          ├── npm install redscript-mc@latest
          ├── node build.mjs
          └── wrangler pages deploy
```

推一次 `main`，npm、VSCode Marketplace、在线 IDE 全部自动更新。

---

## 数字总结

- **684 个测试**，22 个测试套件全部通过
- **28 种实体类型**（14 种敌对怪物，6 种被动怪物，若干抽象节点）
- **4 个新警告码**：`W_IMPOSSIBLE_AS`、`W_UNKNOWN_ENTITY_TYPE`
- npm：`redscript-mc@1.2.25`
- VSCode：`bkmashiro.redscript-vscode@1.0.13`
