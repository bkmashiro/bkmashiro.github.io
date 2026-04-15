---
date: 2026-04-15
description: "2026年4月构建的六个项目：环境差异工具、AI 文件系统、管道调试器、状态机 DSL、多语言脚本运行器，以及 Python 隐写术工具。"
title: "我在 2026 年 4 月构建了什么"
readingTime: true
tag:
  - Projects
  - Python
  - Dev Tools
outline: [2, 3]
---

四月是那种让我停不下来的月份。大约两周内做了六个项目，全部用 Python，全都在挠不同的痒——但回头看这些项目的整体，有一条清晰的主线：让不可见的东西变得可见。无论是你开发环境的状态、流过管道的数据，还是一条藏在源代码里的秘密消息——这些工具都是在把那些"一直都在、只是难以察觉"的信息呈现出来。

以下是我做了什么、为什么做，以及一路上学到了什么。

## Strata — 环境考古学

[GitHub](https://github.com/bkmashiro/strata) · 3 次提交 · Python · SQLite

我们都经历过这种情况。某个东西挂了。"昨天还好好的。" 接下来的三十分钟你手动检查环境变量、运行中的进程、Docker 容器、包版本——试图找出你没注意到的时候，脚下悄悄变了什么。

Strata 把这整个过程自动化了。它对你的开发环境做时间点快照——环境变量、开放的网络端口、运行中的进程、配置文件校验和、磁盘用量、Docker 状态、已安装的包版本——并存入本地 SQLite 数据库。出问题的时候，运行 `strata diff baseline now`，就会得到一份彩色报告，精确显示哪里变了。

```bash
strata diff morning afternoon

# envvars
#   + STRATA_DEMO_VAR: 'hello-world' (added)
#   ~ PATH: '/usr/bin' -> '/usr/local/bin:/usr/bin'
# network
#   + Port 3000 now listening (tcp)
#   - Port 8080 no longer listening
# packages
#   ~ node: v18.17.0 -> v20.11.0
```

我最满意的设计决策是收集器架构 (collector architecture)。每个数据源（环境变量、进程、网络等）都是一个独立的收集器类，实现 `collect()` 和 `is_available()` 两个方法。这意味着 Strata 能优雅地降级——如果 Docker 没有安装，Docker 收集器就报告自身不可用并跳过。不崩溃，不需要配置。我一开始写了 8 个收集器，到第二次提交时扩展到了 13 个，新增了包管理器细分、git 仓库状态、crontab、SSH 密钥和云配置。架构让这件事变得极其简单。

最新加入的是 git 集成——Strata 现在会在每个快照旁边自动记录当前的提交哈希，让你可以用 `strata bisect packages python3` 来查看某个包的版本在你的提交历史里是如何变化的。光是最后一次提交就有 934 行改动分布在 6 个文件里，主要是 git 集成和新收集器。这个特性把一个好用的调试工具变成了你愿意挂在 post-commit hook 上一直跑的东西。

## BranchFS — 为 AI 智能体设计的文件系统

[GitHub](https://github.com/bkmashiro/branchfs) · Python · FUSE + 降级模式

这个项目来自于观察 AI 智能体在探索时的困境。当一个智能体尝试方案 A、失败了、想试方案 B，它该怎么办？手动撤销改动？开一个 Docker 容器？用 git（那是为人类设计的，不是为机器）？

BranchFS 是一个专为 AI 智能体设计的写时复制 (copy-on-write) 分支文件系统。一毫秒内分叉一个分支，做改动，评估结果，合并或丢弃。没有暂存区，没有提交信息，没有交互式变基——只有快速、确定性的操作，智能体可以在紧密循环中调用。

```python
with fs.branch_context(snap_id, name="try-something") as branch:
    (branch.workdir / "solution.py").write_text("def solve(): ...")
    result = evaluate(branch.workdir)
    if result.good:
        branch.merge()
    # 没有合并？改动自动丢弃。
```

有趣的技术挑战是让它在所有环境下都能运行。在有 FUSE 的 Linux 上，BranchFS 挂载为透明文件系统——智能体正常读写，写时复制在内核层发生。但 AI 智能体经常运行在没有 FUSE 权限的容器里。所以有一个降级模式，用临时目录和 `shutil` 提供完全相同的 API。接口一样，语义一样，不需要内核模块。内容寻址 (content-addressable) 的 blob 存储（以 SHA-256 命名的文件）在两种模式下都处理去重，即使智能体分叉了几十个分支，存储开销也很小。

对比数字说明了一切：分叉时间大约是 1ms（仅元数据），而 git checkout 是 100ms，Docker 容器创建是 1 秒。当你的智能体要探索数百种方案时，这个差距至关重要。

## Pipespy — Unix 管道调试器

[GitHub](https://github.com/bkmashiro/pipespy) · Python · 零依赖

Unix 管道很美，直到它不美了。你写了 `cat log | sort | grep ERROR | sort | uniq -c | sort -rn | head`，它能跑，但你完全不知道哪个阶段是瓶颈、数据在哪里被过滤掉，也不知道你其实排了三次序而本可以只排一次。

Pipespy 是一个针对 shell 管道的性能分析器、调试器和静态分析器。给它一个管道字符串，它会运行每个阶段，同时捕获各阶段之间的耗时、行数、字节数和样本数据。然后它渲染一份可视化报告，显示数据流向，找出瓶颈和过滤量最大的阶段——还有我最引以为傲的部分——检测反模式并给出具体的、可以直接运行的改写建议。

```bash
pipespy "cat log | sort | grep ERROR | sort | grep FATAL | wc -l" --no-run

# Anti-patterns Detected:
#   [i] useless-cat (stage 1)
#       sort can read files directly.
#   [~] sort-before-grep (stage 2)
#       sort processes more data than necessary. Move grep first.
#   [i] grep-wc (stage 6)
#       Replace `grep FATAL | wc -l` with `grep -c FATAL`
```

反模式检测器认识 8 种常见错误（无用的 cat、grep 前排序、连续 grep 链、冗余排序、echo 接管道、grep 接 wc、awk 当 cut 用、大型排序未先过滤），优化器生成 5 种带预估加速比的具体改写。比如加上 `LC_ALL=C` 做字节级比较、对大数据集用 `sort --parallel`，或者简单地把过滤步骤移到排序之前。

解析器是最棘手的部分。管道字符串并不像按 `|` 分割那么简单——你得处理引号里的参数、嵌套的子 shell、转义的管道符和环境变量前缀。搞定这些大约占了 30% 的工作量。另一个值得一提的设计决策：`--no-run` 标志做纯静态分析，不执行任何东西，这意味着你可以对涉及生产文件的管道做 lint 而不会真的碰到它们。

## Machina — 状态机 DSL

[GitHub](https://github.com/bkmashiro/machina) · 2 次提交 · 纯 Python · 零依赖

状态机到处都是——协议、UI 流程、游戏逻辑、工作流引擎——但在通用语言里定义它们总感觉别扭。你最终会得到一团枚举、switch 语句和转移表，难以阅读，根本无法静态分析。

Machina 是一个用于状态机的领域特定语言 (DSL)。你用简洁的语法写 `.machina` 文件，定义状态、转移、守卫条件和动作，工具包可以模拟执行、生成 Graphviz/Mermaid 图表——还有最核心的特性——对组合系统做静态分析以发现并发 bug。

```
machine Turnstile {
    var fare = 0
    state locked {
        on coin -> unlocked { action: fare += 1 }
        on push -> locked
    }
    state unlocked {
        on push -> locked
        on coin -> unlocked { action: fare += 1 }
    }
    initial locked
}
```

并行组合是真正有趣的地方。你定义多个共享事件的机器，Machina 构建它们状态空间的笛卡尔积，然后运行可达性分析 (BFS) 和 Tarjan 强连通分量 (SCC) 算法来找死锁、不可达的组合状态、同步冲突和活锁风险。这本质上是一个轻量级模型检查器——在任何运行时代码存在之前，在设计阶段就能捕获并发 bug。

实现是经典的编译器流水线：词法分析器、递归下降解析器、AST，然后分叉到分析器、组合器、执行器或可视化器。我选择零外部依赖（纯 Python 3.11+），因为 DSL 工具包的意义就在于能轻松安装。测试套件覆盖了词法分析器、解析器、分析器、执行器、组合器和可视化器的 73 个用例。`demo/` 文件夹里有一个哲学家就餐的例子，演示死锁检测——看着工具自动发现 bug 总是令人满足的。

## Chimera — 多语言脚本运行器

[GitHub](https://github.com/bkmashiro/chimera) · Python · 支持 Python、JS、Bash、SQL

这个项目源于对胶水脚本的烦恼。你有一个 SQL 查询，输出给 Python 变换，再输出给 Bash 部署步骤。现在这意味着三个独立文件、脆弱的 shell 管道，或者一个你不想维护的 Jupyter 服务器。Chimera 让你把所有内容放在一个 `.chimera` 文件里，用语言分隔的节区来组织。

```
--- python
users = [{"name": "Alice", "score": 95}, {"name": "Bob", "score": 82}]

--- javascript
topScorers = users.filter(u => u.score >= 90);
console.log("Top:", topScorers.map(u => u.name).join(", "));

--- sql @memory
SELECT name, score FROM users WHERE score > 90

--- python
for row in result:
    print(f"{row['name']}: {row['score']}")
```

魔法在于数据桥接。一个节区里定义的变量会自动作为原生类型流入下一个节区。Python 列表变成 JavaScript 数组。字典列表变成 SQLite 表。Bash 获得大写的环境变量和一个 `chimera_export` helper 来向后传递数据。每个语言执行器把用户代码包裹在一个 harness 里，在执行前注入上下文，执行后捕获新变量——对于 Python，这意味着执行前 `globals().update(context)`，之后检查 `dir()`。

架构有 95 个测试，覆盖解析器、上下文系统、各语言执行器、运行器和完整集成。我对错误处理格外用心——当一个 JavaScript 节区失败时，错误信息会包含节区编号和原始行号，而不是包装层的行号。细节，但让调试多语言脚本真的变得可行。

## Murmur — Python 源码隐写术

[GitHub](https://github.com/bkmashiro/murmur) · Python · 零依赖

这是最奇怪的一个。Murmur 把秘密消息藏在 Python 源码里，利用的是 Python 语法提供等价选择的地方。单引号还是双引号？`x += 1` 还是 `x = x + 1`？`return x` 还是 `return (x)`？`x is None` 还是 `x == None`？每个选择点编码一个比特。修改后的文件语法合法、功能完全相同，但携带了隐藏的载荷。

```bash
murmur analyze mycode.py
# Total capacity: 292 bits (31 usable bytes)
#   string_quote: 153 sites
#   return_paren: 28 sites
#   trailing_semicolon: 93 sites

murmur encode mycode.py "secret message" -o encoded.py
python encoded.py  # 输出与原版完全相同
murmur decode encoded.py  # "secret message"
```

六个编码通道（字符串引号、增强赋值、return 括号、比较顺序、None 检查风格和尾随分号）各自扫描源码中可用的位点并独立翻转。基于密钥的 Fisher-Yates 洗牌算法决定哪些位点携带哪些比特，所以没有密钥的话，你需要暴力枚举位点顺序。

最有趣的工程问题是跨通道干扰。把 `x += 1` 改成 `x = x + 1` 会移动该行后续所有内容的列位置，这可能使同一行其他通道的位点失效。解决方案是迭代编码器：编码所有比特，重新扫描，检查不匹配，重新应用，直到收敛。实践中需要 1-2 轮。一个 8 位校验和（截断的 SHA-256）用于检测错误密钥或损坏的载体。

使用场景虽窄但确实存在：用于证明作者身份的代码水印、追踪哪份代码库副本泄露了，以及篡改检测（修改载体会破坏消息）。它不是密码学意义上的强健隐写术——对风格选择的统计分析可以检测到它——但它是对"风格即信息"这一原则的一次真正有趣的应用。

## 这些项目的共同点

把这六个项目放在一起看，我看到了一条超越"开发者工具"的共同线索。每一个都是关于**让隐藏的结构变得显式**。

Strata 让你的开发环境里那种无形的漂移变得可见。BranchFS 把 AI 智能体内部所做的分支探索变成了一个具体的、可检查的文件系统操作。Pipespy 揭示了管道内部通常不透明的数据流和性能特征。Machina 把通常隐式散落在代码里的状态机逻辑提升为一个可以分析的一等表示。Chimera 让语言之间的数据交接——通常被埋在序列化胶水代码里——变得自动而透明。而 Murmur 朝着相反方向走，故意在看似不存在结构的地方隐藏结构。

这些项目也都是纯 Python、零或最少依赖，设计成五分钟就能上手。我最近热衷于构建那种"一个 `pip install` 就能用上"的工具。不需要 Docker，不需要运行服务器，不需要写配置文件。就是一个把一件事做好的 CLI。

四月还没结束，但这六个感觉已经是一个完整的集合。每一个都教会了我一些东西——收集器架构、FUSE 文件系统内部原理、管道解析的边缘情况、乘积状态空间分析、跨进程变量序列化，以及 Python 语法歧义出人意料的深度。不是个坏月份。
