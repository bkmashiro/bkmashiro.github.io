---
date: 2026-04-15
description: "什么样的提交信息才算好？通过真实提交历史的模式分析，梳理常见反模式，以及写出让未来的自己感谢自己的提交信息背后的哲学。"
title: "提交信息的艺术：你的 Git 日志说明了什么"
readingTime: true
tag:
  - Git
  - Dev Tools
  - Software Engineering
outline: [2, 3]
---

对同一个改动——测试套件里一个竞态条件的修复——考虑两条提交信息：

```
Fixed wait condition in test worker kill process
```

```
fix: replace sleep-based sync with process.Wait() in worker kill test
```

第一条告诉你有东西改了。第二条告诉你*哪里*出了问题、*用什么*替换了它、*在哪个地方*。六个月后，当 `git bisect` 把你停在这个提交上，其中一条信息会帮你省下二十分钟。另一条会让你去读 diff。

我翻阅了我参与或维护过的大约十五个代码仓库的提交历史——从小型 CLI 工具到有几百次提交的全栈应用——并对发现的内容做了分类。模式足够一致，值得写出来。

## 为什么提交信息很重要（考古学论证）

提交日志是你代码库的考古层。当你对一行令人困惑的代码运行 `git blame`，发现提交信息是"update"，你什么也学不到。当你发现"fix: silent fallback to zero for unresolved identifiers in MIR lowering"，你立刻理解了意图，并能判断当前代码是否仍然服务于那个目的。

三个工具让提交信息成为关键：

- **`git blame`** — "这行代码为什么存在？" 只有当提交信息回答了这个问题时才有用。
- **`git bisect`** — 二分查找引入 bug 的提交。好的信息让你一眼就能跳过明显不相关的提交。
- **`git log --oneline`** — 不需要维护的变更日志。如果你的提交信息够好，*这就是*你的变更日志。

提交信息的受众不是今天审查你 PR 的评审者。是六个月后凌晨两点调查生产故障的开发者（可能就是你自己）。

## 反模式动物园

以下是我发现的真实模式，按危害程度排列。

### 单词黑洞

```
logging
logging cleanup
debugging
proc
fix adapter
```

这些来自一个真实仓库。连续五个提交，日志里什么也没说清楚。"logging cleanup"——哪个日志？哪里不干净？"proc"——进程什么？"debugging"——你提交了你的调试代码？还是修了一个你在调试的 bug？

解决方法很简单：花十秒钟。"Remove verbose stdout logging from worker lifecycle" 写起来要十秒，理解起来省十分钟。

### 有动词没宾语

```
update readme
use tmp subfolder
fix file adapter
```

"Update readme" 是世界上最常见的提交信息，也是信息量最少的。你更新了 README 的*什么*？"Add installation instructions to README" 是一条信息。"update readme" 是一个耸肩。

"Fix file adapter"——哪个文件适配器？什么坏了？对比另一个仓库里的信息："fix: silent TOML config parse failures to surface errors to users。" 字数相当，信息量天壤之别。

### 反复锤击

一个仓库里有这样一段序列：

```
Fixed wait condition in test worker kill process
Fixed wait condition in test worker kill process
Fixed wait condition in test worker kill process
Fixed wait condition in test worker kill process
Fixed wait condition in test worker cancel
```

四条完全相同的信息，后面跟着一个轻微变体。这是"也许这次能行"模式——一个接一个地推送修复尝试，而不是先理解问题。每次提交都是一次猜测，不是解决方案。

这是工作流问题，不是信息问题。这些应该是一个提交："fix: race condition in worker termination tests — replace polling with synchronous Wait()。" 如果你在迭代修复，用 `git commit --amend` 或在合并前 squash。

### 过去时陷阱

```
Implemented healthcheck command
Implemented preview unit tests from BaseEvalFnLayer
Refactored eval only aspects to own function
Created unit test for single feedback case
Wrote test to confirm that exceptions are caught as warnings
```

这些语法没问题，描述也算合理——比"update"或"fix"好多了。但它们用了过去时，而惯例要求祈使语气。标准（由 Linux 内核确立，被 Conventional Commits、Angular 和大多数主流开源项目采用）是祈使语气："Add healthcheck command"，不是"Added healthcheck command"。

为什么？提交信息应该能完成这个句子："如果应用，这次提交将会___。" "如果应用，这次提交将会 *implement healthcheck command*" 读起来很自然。"如果应用，这次提交将会 *implemented healthcheck command*" 就不对了。

这是最重要的事吗？不是。但它是免费的，日志里的一致性很重要。

## 惯例在哪里有用

我审查过的维护最好的仓库使用了一致的前缀惯例：

```
feat: add lens expressions, pattern classifier, and path pinning
fix: correct AI-generated test expectations to match implementation
perf: delta compression + ring buffer storage (no silent drops)
design: fix hardcoded color literals — use design tokens throughout
i18n: tamper detection strings EN/ZH/JP
```

前缀（`feat`、`fix`、`perf`、`design`、`i18n`）让你快速扫描日志。找出哪里出了问题？扫描 `fix:`。想知道这个版本发布了什么？扫描 `feat:`。需要审查安全相关的改动？在认证相关代码附近搜索 `fix:`。

另一个仓库用了自定义惯例——`burn(type):` 加工单 ID 后缀：

```
burn(bug): Fix ne/inequality operator in cmpToMC() for if-score contexts [9GH3DD]
burn(test): Add tests for break/continue label error paths in MIR lowering [D628K0]
burn(docs): Add JSDoc to flattenExecute() and emit() helper functions [HB6X9N]
```

工单 ID（`[9GH3DD]`）把每次提交链接到追踪系统。类别（`bug`、`test`、`docs`）让日志可以快速扫描。它比标准的 Conventional Commits 更冗长，但因为*一致*，所以有效。

### 惯例在哪里是多余的

对于一个只有三次提交的个人项目：

```
Initial implementation of Tempo: adaptive rate limiter with rhythm detection
Add .gitignore and remove cached/generated files from tracking
Remove cached/generated files from git tracking
```

这里没人需要 `feat:` 前缀。信息清晰、有描述性，讲述了故事。前缀在日志有几百条记录、需要过滤时才有价值。对于五次提交的仓库，它们是繁文缛节。

## 经得住时间考验的信息

我找到的最好的提交信息有一个共同模式：它们解释*问题*，而不仅仅是*解决方案*。

```
fix: per-cardKey phase map so leaving card holds answer state during slide
```

这不只是说"修复卡片状态"——它告诉你机制（per-cardKey phase map）和症状（离开卡片时在滑动动画中丢失了答案状态）。一年后，如果有人碰卡片动画代码，这条信息是一个警示："小心，phase map 的存在是有原因的。"

```
feat: detect pre-git timestamp tampering (<2005-04-07); block leaderboard enrollment + show roast banner
```

这条对于主题行来说几乎太详细了，但它包含了检测阈值、后果和用户可见的结果。不读 diff 你就能从提交信息里理解整个特性。

对比一下：

```
fix adapter
```

其中一条到了 2028 年还能读懂。另一条现在已经读不懂了。

## 启发式原则

在你按下回车确认提交信息之前，做这个测试：

**如果有人只读这个文件的 `git log --oneline`，他们能理解这次改动*为什么*存在吗？**

不是*改了什么*——diff 会告诉你。而是*为什么*改。哪里坏了，缺少什么，目标是什么。

第二个测试：**`git bisect` 能从这条信息里获益吗？** 如果你在二分查找一个回归，停在这次提交上，你能在五秒内判断它是否相关吗？

如果两者都是肯定的，你的信息就够好了。如果不是，补上那个缺失的从句——通常是"因为"或"以便"的部分。

## 什么时候可以打破规则

规则是为主线历史存在的。它们不是在任何地方都适用：

- **功能分支上的 WIP 提交**，你会在合并前 squash：随便写什么都行。"WIP stuff" 没问题，只要它不进 `main`。
- **自动化提交**：`chore: auto-bump vscode extension to 1.3.93 [skip ci]` 是机械的，应该看起来就是机械的。不要刻意美化它。
- **初始提交**：`Initial implementation of Strata: Environment Archaeology Tool` 完全没问题。不需要前缀。你在写项目历史的第一句话——让它有分量。
- **Revert 提交**：git 会帮你生成信息。让它来。

目标不是遵守规则。目标是一个讲故事的 `git log`——一个未来开发者能够阅读、搜索和信赖的日志。每条提交信息都是一个微小的文档行为。它们大多数永远不会被阅读。那些被阅读到的，会在最糟糕的时刻被阅读：故障期间、二分查找中、午夜"是谁写的这段代码、为什么"的那一刻。

花那十秒钟。未来的你是受众，而未来的你不会记得"fix adapter"是什么意思。
