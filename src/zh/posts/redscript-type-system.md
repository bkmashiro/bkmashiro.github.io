---
title: "RedScript 类型系统深度解析"
date: 2026-03-22
tags: [redscript, compiler, type-system, minecraft]
description: "从源码出发，分析 RedScript 的核心类型、类型检查流程，以及编译时类型与运行时数据布局之间的边界。"
readingTime: true
tag:
  - RedScript
  - 类型系统
  - 编译器
  - Minecraft
outline: [2, 3]
---

RedScript 的类型系统有一个非常鲜明的特点：它不是为了抽象而抽象，而是为了把高级语言安全地压到 Minecraft datapack 的 scoreboards、NBT storage 和 `execute` 语义里。所以理解 RedScript 类型，不能只看语法名词，还要看“它最后在运行时会变成什么”。

## 基础类型：`int`、`double`、`fixed`、`string`、`bool`

`int` 仍然是最核心的运行时值，绝大多数控制流、计时器、枚举 tag、scoreboard 计算都以它为中心。`fixed` 和 `double` 则体现了 RedScript 对数值语义的区分：`fixed` 是定点数，适合 scoreboard 体系里的可控算术；`double` 是另一条更重的运行时通路，适合需要真实浮点语义的场景。类型检查器已经把它们视为不同数值族，`int -> fixed`、`int -> double` 都不能隐式转换。

`string` 是正常字符串类型；`format_string` 则还保留在 AST/typechecker 里作为兼容旧实现的 legacy annotation。现在 rich text builtin 参数检查接受 `string` 或 `format_string`，说明这两者正在收敛。`bool` 则很朴素，主要服务于条件分支和状态位。

## 代数数据类型：`Option`、`Result`、带 payload 的 enum

AST 里已经有 `option` type、`Some(expr)`、`None`、`if let Some(...)` 等节点，所以 `Option<T>` 是 RedScript 真正内建进语言的空值安全模型。编译器文章里也提到，像 `Option<int>` 这种值在 lowering 时会拆成 tag 加 payload 槽位，这正是典型 tagged union。

`Result` 要分两层说。概念上，它承担的是“成功值 / 错误码”这类带 payload enum 的角色；现实实现里，当前 stdlib 的 `Result` 还是具体的 `enum Result { Ok(value: int), Err(code: int) }`，并不是泛型 `Result<T>`。因此，从类型系统视角看，RedScript 已经支持“enum with payload”这件事，但标准库里的 `Result` 还没有完全泛型化。

带 payload 的 enum 是整个系统里最关键的一环。无论 `Option` 还是 `Result`，本质都靠 `enumName -> variant -> fields` 这套元信息进入 typechecker，再在 match 时把 payload 绑定到局部变量。也就是说，RedScript 的模式匹配不是字符串替换，而是建立在真实变体布局上的。

## 复合类型：tuple、struct、interface

tuple 是现在最完整的复合类型之一。`(int, int)`、`(a, b)`、`let (x, y) = foo()` 都已经贯通到代码生成。它在运行时不是数组，而是多个固定返回槽位或临时值，因此非常适合作为多返回值机制。

struct 则更像“命名字段的运行时记录”。字段信息会被 typechecker 收集进 `structs: Map<string, Map<string, TypeNode>>`，后续成员访问、成员赋值都靠这张表验证。运行时上，struct 往往会被映射到 scoreboard/NBT 组合，而不是一块真正连续的内存。

`interface` 的边界需要说清。AST 和 parser 已经支持 `interface` 声明，`impl Trait for Type` 也能解析并进入 HIR；但我没有看到完整的接口一致性检查和 trait dispatch。换句话说，interface 目前更接近“语法与中间表示预埋”，而不是已经成熟的类型能力。

## 类型检查是怎么工作的

`src/typechecker/index.ts` 基本体现了 RedScript 当前的策略。第一遍先收集函数、全局、struct、enum、const、impl method；其中 enum 不只记录 variant 编号，还记录 payload 字段列表。之后进入函数体检查时，局部作用域会按语句推进，表达式则由 `inferType` 和一系列专门检查逻辑递归处理。

几个关键点很值得注意。第一，RedScript 的类型检查不是 Hindley-Milner 式推导，而是相对直接、工程化的“声明表 + 局部推断”。第二，匹配分支会根据 `PatEnum` 的 payload 把绑定变量注入新作用域，这就是为什么 `match Result::Ok(value)` 里的 `value` 能拿到精确类型。第三，rich text builtin、selector、事件参数、`@watch`、`@singleton` 这类 Minecraft 特有概念，也直接进入了 typechecker，而不是放到后端报错。

## 编译时 vs 运行时

RedScript 的很多类型只在编译时存在，运行时并不会保留“高级对象”外壳。tuple 会被拆成多个返回槽位；enum-with-payload 会变成 tag 和 payload；struct 会变成 scoreboard/NBT 字段；`@config` 甚至会在编译期直接把值注入输出。

但也有一些类型边界会延伸到运行时。比如 `double` 与 `fixed` 的区分，不只是静态检查不同，它们后端的存储和算术路径也不同；`string` match 会实际落到 `storage rs:strings`；事件参数的 `Player` 类型则影响 `@s` 上下文和 selector 合法性。

所以更准确的说法是：RedScript 不是“静态类型包一层再全部擦除”，而是“编译时尽可能保留语义，运行时只保留目标平台必须知道的布局”。这也是它能把 `Option`、tuple、模式匹配这类高级特性落进 datapack 的根本原因。

## 结语

RedScript 类型系统真正强的地方，不是名词多，而是每个类型都对应一个现实的 lowering 策略。`int/fixed/double` 对应不同数值后端，`Option` 与 payload enum 对应 tag+payload，tuple 对应多返回槽，struct 对应字段表与存储布局，而 interface 目前还处在前半程。理解这些映射关系之后，再看 typechecker 里的各种规则，就会发现它不是在模仿传统语言，而是在为 Minecraft 这个极不友好的目标平台建立一套足够可靠的静态护栏。
