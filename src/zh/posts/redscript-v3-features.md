---
title: "RedScript v3.0 新特性全解析"
date: 2026-03-22
tags: [redscript, minecraft, compiler, gamedev]
description: "基于 RedScript 当前源码与测试，梳理 v3 时代真正落地的语言特性、装饰器与实现边界。"
readingTime: true
tag:
  - RedScript
  - Minecraft
  - 编译器
  - GameDev
outline: [2, 3]
---

RedScript v3 这一轮最值得写的，不是宣传页上的“更强大”，而是哪些能力已经真实打通到了 parser、typechecker、HIR/MIR 甚至 emit，哪些还停留在语法层。把这条边界说清楚，比罗列新关键字更有价值。

## `match on string`：字符串分支终于不是整数黑魔法

`src/__tests__/compiler/match-string.test.ts` 已经把这件事写得很直白：`match cmd { "help" => ... }` 会落成对 `storage rs:strings` 的 `if data ... matches "help"` 检查，而不是先把字符串映射成某个手搓枚举值。对 datapack 开发来说，这很实用，命令字、模式名、UI 输入都能直接分发。它的意义不只是语法更像现代语言，而是字符串值终于进入了编译器可分析的控制流。

## tuple：从“只能返回一个值”到多返回值

tuple 是 v3 里最完整的一项。AST 里有 `tuple` type、`tuple_lit`、`let_destruct`；测试也覆盖了 `(int, int)` 返回类型、`return (a, b)`、`let (q, r) = divmod(...)`。更关键的是 lowering 不是停在语法上：MIR 会写入 `__rf_0/__rf_1`，最终 emit 到 mcfunction 时变成 `$ret_0/$ret_1`。这说明 tuple 在 RedScript 里不是“糖”，而是真正参与调用约定的返回机制。对 Minecraft 这种没有栈、没有寄存器的目标来说，这个设计非常务实。

## `interface/trait`：语法已进来，实现还在半路

这里必须说边界。`src/ast/types.ts` 和 `src/parser/index.ts` 已经支持 `interface Foo { ... }`，`impl Display for Vec2 { ... }` 也能解析并保留到 HIR；`src/__tests__/struct-display.test.ts` 证明了这一点。但目前我没有看到对应的 typechecker 约束、trait method resolution 或 codegen 完整落地，测试里甚至还有 `todo`。所以更准确的说法是：v3 已经把 interface/trait 的语法骨架和部分 HIR 通路搭好了，但还不能把它当作完全可用的 Rust/TS 风格 trait 系统。

## 装饰器：`@singleton`、`@config`、`@watch`、`@deprecated`、`@inline`

这一组特性是 v3 最“工程化”的部分。

`@singleton` 不是语法糖，而是给 struct 注入全局状态模型。typechecker 会为 singleton struct 合成 `Type::get()` / `Type::set(...)`，emit 阶段再为字段生成 scoreboard objective 和 `get/set` 函数。它非常适合游戏全局状态。

`@config` 是编译期注入。测试里 `compile(..., { config: { difficulty: 5 } })` 会直接改变输出 mcfunction 的常量值。也就是说它不是运行时配置文件读取，而是 build-time specialization。

`@watch` 走的是另一条路：编译器生成一个 dispatcher，在 tick 中比较某个 scoreboard objective 的“当前值”和“上一次值”，只有变化时才触发回调。这个机制很适合把计分板当事件源。

`@deprecated` 目前表现为编译期 warning。`src/hir/deprecated.ts` 会遍历 HIR 调用点，生成 `[DeprecatedUsage]` 警告，但不会阻止编译。

`@inline` 则已经进入 optimizer。`src/__tests__/optimizer/inline_fn.test.ts` 显示它能内联单块函数、多块 CFG 函数，并显式避开递归函数、macro 函数和外部函数。对于 datapack 这种“函数调用就是文件跳转”的后端，这种优化很值钱。

## `do-while` / `repeat`

这两个循环都不只是 parser 识别。`src/__tests__/compiler/do-while.test.ts` 表明 `do { ... } while cond` 会在 HIR 降成“先执行 body，再接 while”；`repeat 5 { ... }` 会降成隐藏计数器加 while。换句话说，它们是完整语义特性，不是表面语法糖。对 RedScript 来说，这种 lowering 很合理，因为目标平台最终还是显式循环块。

## `const`、`Result` 与 `format_string` 修复

`const` 现在既能顶层声明，也会进入 typechecker 的只读约束；给 `const` 赋值会直接报错。这个改动不 flashy，但能显著减少 datapack 脚本里常量被误改的问题。

`Result` 需要谨慎描述。文档标题写 `Result<T>`，但当前 `src/stdlib/result.mcrs` 的真实实现还是具体的 `enum Result { Ok(value: int), Err(code: int) }`，并不是泛型代数数据类型。它已经足够用来表达安全除法和错误码传递，但还不能被说成完整泛型 `Result<T>`。

`format_string` 的变化更多是兼容与修复：typechecker 里保留了 `format_string` 这个 legacy type annotation，同时把 rich text builtin 的参数检查放宽为 `string` 或 `format_string`。再加上增强过的 f-string 测试，v3 的方向很清楚：不再把格式化字符串当一套旁路类型系统，而是逐步并回正常字符串语义。

## 结语

如果只看“特性清单”，v3 很容易被说成一次大升级；但从源码看，它其实是一次更成熟的编译器收口。真正完整落地的，是 string match、tuple、多种装饰器、`do-while/repeat`、`const` 和一批字符串/告警/优化能力；`interface/trait` 与真正泛型化的 `Result<T>` 则还在路上。把“已经能稳定编译到 mcfunction 的部分”与“刚进入语法和中间表示的部分”分开看，才是理解 RedScript v3 的正确方式。
