---
title: "AVM：将 AI 智能体记忆挂载为文件系统"
description: "我们用 SQLite 为后端构建了一个 FUSE 文件系统，让 AI 智能体可以用标准 Shell 工具读写记忆——然后花了一天时间调试 macFUSE 的各种怪毛病。"
date: 2026-03-06
readingTime: true
tag:
  - Python
  - AI
  - 系统设计
  - FUSE
outline: [2, 3]
---

AI 智能体会在每次会话之间遗忘一切。标准解法是让智能体在启动时读取一个 `MEMORY.md` 文件——但这是个粗糙的工具。每次会话都加载整个文件，token 开销随时间线性增长，而且没有可供查询的结构。

我们想要更好的东西：一个用于智能体记忆的虚拟文件系统。用 `echo` 写入记忆，用 `cat :search` 查询，用 `cat :recall` 召回相关上下文。使用每个开发者都已经熟悉的工具。

## AVM：智能体虚拟内存

这个项目叫做 **AVM** — [github.com/aivmem/avm](https://github.com/aivmem/avm)。

核心思路：智能体记忆存储在 `/memory/private/akashi/trading/btc_lesson.md` 这样的路径下。SQLite 数据库存储实际内容和元数据（重要性得分、标签、TTL）。Python API 提供结构化访问：

```python
from avm import AVM

avm = AVM()
agent = avm.agent_memory("akashi")

# 带元数据写入
agent.remember(
    "RSI > 70 on NVDA → 5 天内平均 -12%",
    title="nvda_rsi_rule",      # 可选文件名
    importance=0.9,              # 0.0–1.0，影响 recall 排名
    tags=["trading", "nvda"]
)

# Token 预算控制的 recall
context = agent.recall("NVDA 风险", max_tokens=2000)
# 返回紧凑 Markdown：预算内最相关的记忆

# 跨智能体共享：通过 namespace= 参数直接共享
agent.remember(
    "市场状态：risk-off，减少敞口",
    namespace="market"          # → /memory/shared/market/
)
```

`recall()` 方法是关键。它不是加载所有内容，而是按**重要性 × 时效性 × 语义相关性**对候选项打分，选取能装进 `max_tokens` 内的最多条目，并返回一个紧凑的摘要——不是原始文件内容。智能体得到一个受控大小的上下文块，而不是一个不断增长的堆。

可用三种评分策略：`RECENCY`（最新优先）、`IMPORTANCE`（得分优先）、`BALANCED`（默认——结合两者及语义相似度）。

## 基准测试

我们在 Mac Mini 上用 SQLite FTS5 运行了基准测试：

| 操作 | 延迟 |
|------|------|
| `remember()` 写入 | ~0.6ms |
| FTS5 搜索（116 个节点）| **0.14ms** |
| FTS5 搜索（1000 个节点）| **0.16ms** |
| `recall()` 含 token 预算 | **0.11–0.28ms** |
| 语义搜索（sentence-transformers，热）| ~5.6ms |

FTS5 很快，在这个规模下基本是 O(1)。语义搜索在 CPU 上明显更慢——对模糊匹配有用，但大多数 recall 查询并不需要。

## FUSE 层

Python API 很简洁，但这意味着要写代码才能与记忆交互。真正的解锁是 FUSE 文件系统：把 AVM 挂载到 `/tmp/avm`，然后使用标准 Shell 工具。

```bash
avm mount /tmp/avm --daemon

# 写入一条记忆
echo "RSI > 70 → 退出" > /tmp/avm/memory/private/akashi/rsi_rule.md

# 读回
cat /tmp/avm/memory/private/akashi/rsi_rule.md

# 搜索（虚拟节点）
cat /tmp/avm/:search?RSI

# Token 预算召回
cat /tmp/avm/:recall?query=NVDA+风险&max_tokens=2000

# 元数据
cat /tmp/avm/:stats
```

虚拟节点（`:search`、`:recall`、`:stats`、`:meta`、`:tags`）是最精妙的部分——它们不是真实文件，而是 FUSE 可读的端点。读取 `:recall?query=X` 会触发完整的评分和综合流程，并将结果以文件内容形式返回。

## 调试 macFUSE

在 macOS 上让 FUSE 工作花了今天大部分时间。问题链如下：

**问题 1：FUSE 根本无法挂载。**

```
FUSE error: 1
RuntimeError: 1
No FUSE in mount table
```

`fuse_main_real()` 返回 1，没有有用的错误信息。根本原因：macFUSE 内核扩展需要在 _系统设置 → 隐私与安全性_ 中明确授权。扩展已安装但未获授权。授权并重启后，FUSE 挂载了——但只挂载了一部分。

**问题 2：`ls` 无限阻塞。**

```
[getattr] / → OK
[getattr] /.DS_Store → ENOENT（预期中）
ls（阻塞，永不返回）
```

`getattr` 在工作，但 `readdir` 从未被调用。解决方法：macFUSE 要求实现 `opendir` 和 `releasedir` 方法，否则 `readdir` 会被静默跳过。fusepy 对此文档不清楚。添加两个存根实现解决了问题：

```python
def opendir(self, path):
    return 0

def releasedir(self, path, fh):
    pass
```

**问题 3：挂载状态检测出错。**

守护进程模式工作后，`avm status` 显示「stale」，即使已经挂载。代码用 `mount` 检查挂载状态，但在 macOS 上，`mount` 不在子进程的默认 `$PATH` 中——它在 `/sbin/mount`。一行修复。

**问题 4：`fusepy` 不在必需依赖中。**

`fusepy>=3.0` 在 `pyproject.toml` 中被列为可选依赖。通过 `pip install avm` 安装会跳过它，导致 `ModuleNotFoundError: No module named 'fuse'`。移到必需依赖。

四个问题全部修复后，完整测试套件通过：

```
:meta ✓  :tags ✓  :stats ✓  :search ✓  :recall ✓
守护进程模式 ✓  持久化 ✓  文件读写 ✓
```

## 下一步

我们讨论的异步嵌入队列设计：`remember()` 立即写入内容，后台线程生成嵌入，`recall()` 在嵌入尚未就绪时回退到 FTS。这样写入延迟保持在 <1ms，同时最终能实现不阻塞调用方的语义搜索。

测试覆盖率今天达到 49%（从 40% 提升）。剩余缺口在 `mcp_server.py`（0%）、`providers/*`（~20%）和 `permissions.py`（34%）。

目标是让智能体像对待文件系统一样对待记忆——因为它就是文件系统。
