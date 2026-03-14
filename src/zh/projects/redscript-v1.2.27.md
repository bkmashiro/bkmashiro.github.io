---
title: "RedScript v1.2.27：BigInt 实机验证通过"
date: 2026-03-14
tags: [编译器, minecraft, typescript, 编程语言, bugfix]
description: "BigInt 任意精度整数在 Paper 1.21.4 实机验证正确。根本原因：Minecraft 宏机制对整数值的静默替换 bug 导致所有 NBT 数组写入归零。改用 execute store result storage 修复。"
readingTime: true
tag:
  - 编译器
  - Minecraft
  - TypeScript
  - 编程语言
outline: [2, 3]
---

与 v1.2.26 同一天 — 但 BigInt 真正能跑之前还有一个 bug 要修。

- GitHub：[bkmashiro/redscript](https://github.com/bkmashiro/redscript)
- npm：[redscript-mc](https://www.npmjs.com/package/redscript-mc)
- 文档：[redscript-docs.pages.dev](https://redscript-docs.pages.dev)
- 在线 IDE：[redscript-ide.pages.dev](https://redscript-ide.pages.dev)

---

## Bug：实机 BigInt 全输出 0

v1.2.26 发布了 `bigint.mcrs`，26 个单元测试全部通过。但第一次真机测试：

```
/function showcase:debug_bigint
[5] fib(10) → get_a(0)=0   (expect 55)
[6] fib(20) → get_a(0)=0   (expect 6765)
```

所有 BigInt 输出都是 0。模拟器通过，Paper 1.21.4 实机不通过。

## 诊断过程

**第一步 — 记分板是否工作？** 正常。`scoreboard players set $x rs 9999` + 回读返回 9999。

**第二步 — 原始 MC 命令是否工作？** 正常。手动运行：
```mcfunction
/scoreboard players set $testvar rs 777
/data modify storage rs:bigint a set value [0,0,0,0,0,0,0,0]
/execute store result storage rs:bigint a[0] int 1 run scoreboard players get $testvar rs
/data get storage rs:bigint a
```
返回 `[777, 0, 0, 0, 0, 0, 0, 0]`。命令本身工作正常。

**第三步 — 但 `bigint_from_int_a` 写入无效？** 调用函数后 `/data get storage rs:bigint a` 显示 `[0, 0, 0, 0, 0, 0, 0, 0]`。写入在发生，但存入的是 0。

编译出的 `bigint_add` 循环对动态下标写入使用了这个模式：

```mcfunction
# __ssi_6.mcfunction（宏子函数）
$data modify storage rs:bigint c[$(__ssi_i_4)] set value $(__ssi_v_5)
```

`$(val)` 宏替换 — 从 `rs:heap` 中取整数值 — **在 MC 1.21.4 里静默失败**。命令执行没有报错，但值没有被应用，结果所有写入都存了 0。

## 根本原因：Minecraft 宏整数值替换 Bug

`$data modify storage ... set value $(n)` 本应将 `$(n)` 替换为宏 compound 中的整数并写入 NBT。在 Paper 1.21.4 实践中，这个替换要么静默失败，要么替换后的值没有被 NBT 解析器识别为 TAG_Int。

## 修复方案

把值替换宏换成基于记分板的写入方式：

```typescript
// 修复前：宏替换值
this.emitRawSubFunction(subFnName,
  `\x01data modify storage ${ns} ${key}[$(${macroIdxKey})] set value $(${macroValKey})`
)

// 修复后：只宏替换下标；值从记分板槽位读取
this.emitRawSubFunction(subFnName,
  `\x01execute store result storage ${ns} ${key}[$(${macroIdxKey})] int 1 run scoreboard players get ${valVar} rs`
)
```

现在只有**数组下标**通过宏替换；**值**直接从编译期确定的记分板槽位读取，写入子函数的是硬编码的实体名。这在所有测试过的 MC 版本中都能正确工作。

一个细节：优化器会把 `valVar` 的赋值当成死代码消除掉，因为该变量只作为字符串字面量出现在宏子函数里，对 IR 优化器不可见。修复同时在主函数体中额外 emit 一行 `execute store result storage rs:heap ${macroValKey} ...`，让优化器认为该变量是"被使用"的。

## 另一个 Bug：Mangle Slot 不稳定

调试过程中还发现：给 `showcase.mcrs` 加 `debug_bigint` 函数引入了一个新常量（`9999`），使整个 mangle 表整体偏移一位。这导致参数传递寄存器（`p0`）在新编译中从 `$al` 变成了 `$am` — 但只在调用方生效；被调用方（`bigint_from_int_a`）用的是旧版，仍从 `$al` 读参数。

教训：**必须每次从单次编译的全量输出部署数据包**。混用不同编译版本的文件会破坏调用约定。

这是当前 name mangling 设计的已知限制，后续版本可能为内部寄存器引入稳定的语义名。

## 验证结果

修复后在 Paper 1.21.4 实机验证全部正确：

```
fib(0)  = 0     ✓
fib(5)  = 5     ✓
fib(10) = 55    ✓
fib(15) = 610   ✓
fib(20) = 6765  ✓
fib(50) = 12586269025  ✓（3 个 NBT limbs：9025、8626、125）
```

918 个单元测试通过。BigInt 正式可用。

## v1.2.27 其他修复

**`atan2_fixed` 返回类型说明**：该函数返回整数度数（0–360），不是毫度×1000。showcase 示例之前错误地将结果除以 1000。

**`mod_pow` 溢出说明**：`mod_pow(base, exp, m)` 内部执行 `b*b % m`。当 `m > 46340` 时，`b*b` 可能超过 INT32_MAX（2,147,483,647）— Minecraft 记分板是 32 位整数。示例改为使用小 modulus：`mod_pow(2, 10, 1000) = 24` 和 `mod_pow(7, 5, 13) = 11`。

---

## 升级方式

```bash
npm install -g redscript-mc@1.2.27
```

或直接使用[在线 IDE](https://redscript-ide.pages.dev) — 无需安装。
