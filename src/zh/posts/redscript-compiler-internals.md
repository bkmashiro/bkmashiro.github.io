---
title: "RedScript 编译器架构解析"
date: 2026-03-21
tags: [redscript, compiler, minecraft, ir]
description: "从 Parser 到 HIR、MIR、LIR，再到 .mcfunction 输出：RedScript 如何把高级语言特性编译到 Minecraft Datapack。"
readingTime: true
tag:
  - RedScript
  - 编译器
  - Minecraft
  - IR
outline: [2, 3]
---

RedScript 的核心问题不是“怎么解析一门语言”，而是“怎么把高级语义压进一个几乎没有控制流抽象的目标平台”。Minecraft Datapack 最终只有一堆 `.mcfunction` 文件，而函数调用、变量、枚举、模式匹配这些概念，都必须在编译阶段被拆成 scoreboard、storage 和 `execute` 命令链。

因此 RedScript 的编译器没有停在 AST 上直接 codegen，而是走了一条比较典型、但针对 MC 目标做过裁剪的流水线：Parser → HIR → MIR → LIR → `.mcfunction`。

---

## Parser：先拿到“语法正确且结构化”的程序

Parser 负责把 token 流变成 AST。这里处理的是语法问题：优先级、块结构、函数声明、装饰器、`match`、`for-each`、枚举构造等。这个阶段不会决定变量放在哪个 scoreboard，也不会决定一个 `match` 最终是 if 链还是跳表。

Parser 的输出要尽量保留源语言意图。比如 `match value { Some(x) => ..., None => ... }` 在 AST 里仍然是“带模式的分支”，而不是提前降低成一堆临时变量和条件跳转。原因很简单：过早 lowering 会把后续分析需要的结构信息抹掉。

---

## HIR：做语义分析最舒服的一层

HIR 可以理解成“类型化、去语法糖前”的中层表示。到了 HIR，名字解析、作用域绑定、类型检查基本都已经完成，节点不再是纯语法，而是带明确语义的结构。

例如 `for item in players` 在 HIR 里不是普通 `for`，而是 `ForEach(binding=item, iterable=players, body=...)`。`enum` payload 也会在这层拥有明确布局，比如 `Option<int>` 会被视为“判别值 + 一个整数载荷”，而不是若干零散语法节点。

这样做的价值是，复杂语言特性都能先在语义层被证明成立，再进入后续 lowering。否则你会在生成 `.mcfunction` 之前才发现某个模式绑定根本无效，那时代价已经太高。

---

## MIR：把高级结构拆成可执行控制流

MIR 是 RedScript 真正“编译开始”的地方。它仍然保留变量和基本块，但控制流已经显式化，很多高级结构会在这里展开。

`match` 的实现就是典型例子。假设有：

```rs
match state {
    Idle => idle_tick()
    Walking => walk_tick()
    Combat(target) => attack(target)
}
```

在 MIR 里，它会先读取判别值，再生成一串条件跳转块。无 payload 的分支只比较 tag；有 payload 的分支除了比较 tag，还会把载荷从临时槽读出并绑定到本地变量。也就是说，`match` 本质上被展开成“判别 + 绑定 + 跳转”。

`for-each` 也是在 MIR 里变得具体。对数组迭代时，它会变成索引变量、长度读取和循环块；对实体选择器迭代时，则会被标记成一类特殊执行上下文，供下游生成 `execute as ... run function ...`。这一步很重要，因为 Minecraft 没有“多条语句的 execute body”，循环体通常必须被提取成子函数。

---

## enum payload：为什么必须显式布局

RedScript 的 `enum payload` 本质是代数数据类型，但 Minecraft 没有原生 tagged union。编译器通常会把它拆成两部分：

- 一个 tag scoreboard，表示当前变体编号。
- 一组 payload 槽位，存储该变体携带的数据。

例如 `Option<int>` 可以编译为 `tag=0/1` 加一个 `payload0`。`Some(42)` 就是把 tag 设成 `1`，再把 payload0 设成 `42`；`None` 则把 tag 设成 `0`。之后 `match` 只需要先比较 tag，在命中 `Some(x)` 时把 payload0 读到局部变量 `x`。

这个显式布局看起来低级，但它让编译器可以稳定地在 MIR 和 LIR 之间传递数据，不需要在 codegen 阶段重新猜“这个 enum 当初是什么意思”。

---

## LIR：贴近 mcfunction 的最后一层

到了 LIR，目标就不是“表达语义”，而是“表达命令”。变量会被映射到具体 scoreboard player 名称，临时值会被分配到固定槽位，基本块之间的跳转会改写成函数调用或条件执行链。

这层常见的指令形态已经非常接近最终输出，例如：

- `scoreboard players operation`
- `execute if score ... run function`
- `data modify storage ...`

LIR 的好处是把“目标平台约束”隔离出来。Parser/HIR/MIR 都可以保持语言视角，而 LIR 专门处理 Minecraft 的奇怪现实，比如没有原生 `goto`、没有栈、没有寄存器、函数调用成本高、条件执行依赖 `execute` 链组合。

---

## `.mcfunction` 生成：文件树就是控制流图

最后一步是把 LIR 落成 datapack 文件树。这里一个很关键的思想是：在 Minecraft 里，文件本身就是控制流节点。一个基本块通常对应一个 `.mcfunction` 文件，块间跳转被表示成 `function namespace:path/to/block_x`。

所以 RedScript 不是“生成一个大脚本”，而是把 CFG 拆成多个小函数。这样虽然文件数会上去，但和 Minecraft 的执行模型是对齐的，也更利于后续做块级优化、子函数复用和调试定位。

---

## 结语

RedScript 这条流水线的重点，不在于名字像传统编译器，而在于每一层都承担一个明确责任：Parser 保留语法结构，HIR 承载语义，MIR 展开控制流，LIR 面向命令约束，最终再映射到 `.mcfunction`。`match`、`for-each`、`enum payload` 这些看起来“高级”的特性，正是靠这种分层才能稳定落地到 datapack。

如果直接从 AST 往 `.mcfunction` 硬翻，当然也能做出一个能跑的原型；但要想让语言继续扩展，这种中间表示分层几乎是必需品。
