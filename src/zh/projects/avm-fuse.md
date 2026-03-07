---
title: "AVM：把 AI Agent 的记忆挂载成文件系统"
description: "我们用 SQLite 做后端实现了一个 FUSE 文件系统，让 AI Agent 可以用普通 shell 工具读写自己的记忆——然后花了一天 debug macFUSE 的各种坑。"
date: 2026-03-06
readingTime: true
tag:
  - Python
  - AI
  - 系统设计
  - FUSE
outline: [2, 3]
---

AI Agent 每次 session 结束都会忘掉所有东西。标准做法是把记忆写到 `MEMORY.md`，下次启动时全量读入——但这太粗暴了。每次 session 都要加载整个文件，token 消耗随时间线性增长，而且没有任何结构可以查询。

我们想要更好的方案：一个专门为 Agent 记忆设计的虚拟文件系统。用 `echo` 写记忆，用 `cat :search` 查询，用 `cat :recall` 召回相关上下文。用每个开发者都已经熟悉的工具。

## AVM：Agent Virtual Memory

这个项目叫 **AVM**——[github.com/aivmem/avm](https://github.com/aivmem/avm)。

核心思路：Agent 的记忆存放在类似 `/memory/private/akashi/trading/btc_lesson.md` 的路径下。SQLite 数据库存储实际内容和元数据（重要性评分、标签、TTL）。Python API 提供结构化访问：

```python
agent = vfs.agent_memory("akashi")

# 写入
agent.remember("NVDA RSI > 70 → 平均 5 日回调 12%",
               importance=0.9, tags=["trading", "nvda"])

# Token 预算控制的召回
context = agent.recall("NVDA 风险", max_tokens=2000)
# 返回紧凑 markdown：预算内最相关的记忆

# 跨 Agent 共享
agent.share("/memory/private/akashi/market_regime.md", "shared/trading")
```

`recall()` 是核心。不是加载全部内容，而是按 **重要性 × 时效性 × 语义相关性** 对候选记忆评分，在 `max_tokens` 预算内选取最多，返回紧凑摘要——不是原始文件内容。Agent 拿到的是可控大小的上下文块，而不是不断膨胀的全量转储。

## 基准测试

在 Mac Mini 上用 SQLite FTS5 跑的结果：

| 操作                                  | 延迟            |
| ------------------------------------- | --------------- |
| `remember()` 写入                     | ~0.6ms          |
| FTS5 检索（116节点）                  | **0.14ms**      |
| FTS5 检索（1000节点）                 | **0.16ms**      |
| `recall()` token 预算                 | **0.11–0.28ms** |
| 语义搜索（sentence-transformers，热） | ~5.6ms          |

FTS5 极快，在这个量级下几乎 O(1)。语义搜索在 CPU 上明显更慢——适合模糊匹配但大多数召回查询用不上。

## FUSE 层

Python API 很干净，但使用记忆还是需要写代码。真正的突破是 FUSE 文件系统：把 AVM 挂载到 `/tmp/avm`，然后用普通 shell 工具操作。

```bash
avm mount /tmp/avm --daemon

# 写记忆
echo "RSI > 70 → 减仓" > /tmp/avm/memory/private/akashi/rsi_rule.md

# 读回
cat /tmp/avm/memory/private/akashi/rsi_rule.md

# 搜索（虚拟节点）
cat /tmp/avm/:search?RSI

# Token 预算召回
cat /tmp/avm/:recall?query=NVDA风险&max_tokens=2000

# 统计信息
cat /tmp/avm/:stats
```

虚拟节点（`:search`、`:recall`、`:stats`、`:meta`、`:tags`）是最巧妙的设计——它们不是真实文件，而是 FUSE 可读的端点。读取 `:recall?query=X` 会触发完整的评分和合成流水线，把结果作为文件内容返回。

## Debug macFUSE

让 FUSE 在 macOS 上正常工作花了今天大半天时间。Bug 链如下：

**问题 1：FUSE 完全挂不上。**

```
FUSE error: 1
RuntimeError: 1
No FUSE in mount table
```

`fuse_main_real()` 返回 1，没有任何有用的错误信息。根因：macFUSE 内核扩展需要在「系统设置 → 隐私与安全性」里手动授权。扩展已安装但未授权。授权并重启后，FUSE 挂载成功——但只是部分可用。

**问题 2：`ls` 永久阻塞。**

```
[getattr] / → OK
[getattr] /.DS_Store → ENOENT（正常）
ls（卡住，永不返回）
```

`getattr` 正常，但 `readdir` 从未被调用。原因：macFUSE 需要实现 `opendir` 和 `releasedir` 方法，否则 `readdir` 会被静默跳过。Fusepy 文档对此没有说明。加上两个空实现就解决了：

```python
def opendir(self, path):
    return 0

def releasedir(self, path, fh):
    pass
```

**问题 3：挂载状态检测失效。**

Daemon 模式工作后，`avm status` 仍然显示"stale"。代码用 `mount` 命令检查挂载状态，但在 macOS 上，`mount` 不在子进程的默认 `$PATH` 里——正确路径是 `/sbin/mount`。一行修复。

**问题 4：`fusepy` 不在必需依赖里。**

`fusepy>=3.0` 在 `pyproject.toml` 里是可选依赖。通过 `pip install avm` 安装时会跳过，导致 `ModuleNotFoundError: No module named 'fuse'`。改为必需依赖。

四个 bug 全修完后，完整测试套件通过：

```
:meta ✓  :tags ✓  :stats ✓  :search ✓  :recall ✓
daemon 模式 ✓  持久化 ✓  文件读写 ✓
```

## 下一步

异步 embedding 队列设计：`remember()` 立即写入内容，后台线程生成 embedding，`recall()` 在 embedding 未就绪时自动 fallback 到 FTS。这样写入保持 <1ms，同时最终能获得语义搜索能力，不阻塞调用方。

今天测试覆盖率从 40% 提升到 49%（144 个测试通过）。剩余缺口：`mcp_server.py`（0%）、`providers/*`（~20%）、`permissions.py`（34%）。

目标是让 Agent 像对待文件系统一样对待自己的记忆——因为它本来就是一个文件系统。
