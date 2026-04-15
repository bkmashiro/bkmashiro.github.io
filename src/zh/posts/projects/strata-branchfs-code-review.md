---
date: 2026-04-15
description: "两个近期项目的代码审查发现：Strata（环境快照）和 branchfs（AI 分支文件系统）。发现的 bug、设计教训，以及如果重来我会怎么做。"
title: "代码审查：Strata 和 branchfs——我发现了什么"
readingTime: true
tag:
  - Code Review
  - Python
  - Systems
outline: [2, 3]
---

在写完代码几周后再来审查自己的代码，是一种特别的体验。当时感觉显而易见的决策，现在看来很可疑。"临时"的快捷方式还在那里。而一些你当时确信是对的东西，结果有 bug，你可以直接追溯到某个凌晨两点做出的假设。

我对我最近写的两个项目做了深度审查：**Strata**——一个对开发环境状态做快照的环境考古工具，以及 **branchfs**——一个带写时复制语义、为 AI 智能体优化的分支文件系统。两者都是 Python，都不超过 2000 行，都写得很快。以下是我发现的。

## Strata：CLI 对自己一半的收集器一无所知

最令人尴尬的 bug 在 `cli.py` 里。Strata 有 13 个收集器 (collector)——收集不同环境状态切片的模块：环境变量、运行中的进程、网络监听器、磁盘用量、Docker 容器、已安装的包、git 仓库、crontab、SSH 密钥、云配置和 systemd 服务。

CLI 定义了一个 `COLLECTOR_NAMES` 列表，用来支持 `--collector` 过滤标志以及 `search` / `bisect` 命令：

```python
COLLECTOR_NAMES = [
    "envvars", "processes", "network", "files",
    "disk", "system", "docker", "packages",
]
```

八个名字。十三个收集器。五个更新的收集器——`gitrepos`、`crontab`、`ssh_keys`、`cloud_config`、`systemd`——在 `ALL_COLLECTORS` 里注册了，在完整快照时运行也没问题，但 CLI 的 Choice 验证器不知道它们的存在。你没法把快照过滤到只看 git 仓库，没法搜索 crontab 条目，没法对跨提交的 systemd 服务变化做 bisect。

这是那种你在两个地方添加了功能却忘记更新第三个地方时会发生的 bug。收集器注册表（`__init__.py`）和快照逻辑（`snapshot.py`）都动态引用 `ALL_COLLECTORS`。CLI 硬编码了一个列表。修复很简单——加上缺失的名字——但这个模式值得记录：**如果你有一个注册表，从它派生一切。不要维护并行列表。**

## 监视了太多东西的文件监视器

Strata 的文件收集器监视配置文件的变化——`.env`、`Dockerfile`、`pyproject.toml` 以及类似文件。匹配逻辑看起来像这样：

```python
def _should_watch(self, path: Path) -> bool:
    name = path.name
    for pattern in _DEFAULT_WATCH_PATTERNS:
        if "*" in pattern:
            prefix, suffix = pattern.split("*", 1)
            if name.startswith(prefix) and name.endswith(suffix):
                return True
        elif name == pattern or name.startswith(pattern):
            return True
    return False
```

问题在 `else` 分支里。对于像 `.env` 这样的模式，`name.startswith(pattern)` 会匹配 `.envrc`、`.env.example`、`.environment` 以及任何以 `.env` 开头的东西。glob 模式 `.env.*` 已经处理了带点的变体（`.env.local`、`.env.production`）。`startswith` 兜底只是导致了误报。

这意味着 Strata 在给它不应该追踪的文件做校验和——`.envrc` 文件、如果碰巧匹配了前缀的 `.environment` 目录内容、任何前缀匹配的东西。实际影响很小（快照里多了一些条目），但意图明显是错的。修复：在非 glob 分支里只做严格相等判断。

这是我在手写 glob 匹配时经常看到的模式。"宽松"匹配很诱人。但在文件监视器里宽松匹配意味着嘈杂的 diff 和误报的变化检测，这破坏了工具的全部意义。

## branchfs：内容存储里的竞态条件

branchfs 使用一个内容寻址 (content-addressable) 的 blob 存储——文件按 SHA-256 哈希存储，自动去重。写入路径本应是原子的：

```python
def put_bytes(self, data: bytes) -> str:
    blob_hash = self.hash_bytes(data)
    dest = self._blob_path(blob_hash)
    if not dest.exists():
        tmp = dest.with_suffix(".tmp")
        tmp.write_bytes(data)
        tmp.rename(dest)
    return blob_hash
```

概念上模式是对的：写入一个临时文件，然后原子性地重命名。但临时文件路径是确定性的——`{hash}.tmp`。如果两个进程（或 FUSE 挂载中的两个线程）同时尝试存储同一个 blob，它们会写入同一个 `.tmp` 文件。一个写操作会覆盖另一个。最好的情况下，因为内容相同，你得到了一个正确的 blob。最坏的情况下，如果一个进程在写到一半时另一个进程开始写，你得到一个写了一半的数据。

修复方法是 `tempfile.mkstemp`，它保证唯一的文件名：

```python
fd, tmp_path = tempfile.mkstemp(dir=self.objects_dir)
try:
    os.write(fd, data)
finally:
    os.close(fd)
os.rename(tmp_path, dest)
```

这是那种在单线程测试中永远不会遇到、但会在并发 FUSE 访问下表现为静默数据损坏的 bug。内容寻址存储让这个问题格外阴险，因为损坏是内容相关的——只有在两个智能体同时写同一个文件时才会看到。

## FUSE 层仅为了 stat 就读取了整个文件

这不是正确性 bug，但它是那种会让 branchfs 在大文件上不可用的性能问题。在 `fuse_fs.py` 里：

```python
def getattr(self, path, fh=None):
    # ...
    if rel in tree:
        data = self._read_blob(tree[rel])
        return {**self._default_stat, "st_size": len(data)}
```

每次 `getattr` 调用——在每次 `ls`、每次 `stat`、每次任何东西碰到文件时都会发生——都要把整个 blob 从磁盘读入内存，只是为了返回它的大小。对于一个 100MB 的文件，那就是 100MB 的 I/O 来回答"这个文件有多大？"

blob 存储没有单独追踪大小。树将路径映射到哈希，知道大小的唯一方法是读取 blob。正确的修复是在树里存储 `(hash, size)` 元组，或者给 blob 存储添加一个大小索引。我没有修复这个，因为这是一个设计改动，不是 bug 修复——但这是在有人真正尝试在实际项目上使用 FUSE 模式之前我首先要解决的东西。

## 设计观察

### Strata 的收集器架构是好的

尽管有 CLI 的 bug，Strata 里的收集器模式设计得很好。每个收集器是一个有三个方法的类：`collect()`、`is_available()` 和 `diff_entry()`。基类提供合理的默认值。添加一个新收集器意味着写一个文件并加一行 import。diff 逻辑是完全通用的——它只是比较字典。

`diff_entry` 类方法是一个特别好的设计点。每个收集器知道如何为人类格式化自己的变化。磁盘收集器显示百分比变化。进程收集器显示 PID。包收集器统计新增和移除的数量。diff 引擎不需要知道这些任何细节。

### branchfs 的降级模式才是真正的产品

branchfs 有两种模式：FUSE（透明文件系统覆盖）和降级（用 shutil 实化文件）。我先写了 FUSE 模式，因为它更酷。但降级模式才是真正在所有地方都能运行的——在 Docker 里、在 CI 里、在没有 FUSE 支持的系统上。`FallbackBranch` 上下文管理器很干净：

```python
with fs.branch_context(snap_id) as fb:
    (fb.workdir / "file.txt").write_text("data")
    fb.merge()  # 或让它自动丢弃
```

如果重来，我会先构建降级模式，把 FUSE 作为可选的加速层。API 无论如何都是相同的——`BranchFS` 类已经对两种模式做了抽象。只是我碰巧以错误的顺序构建了它们。

### 敏感性过滤器覆盖范围太广

Strata 的环境变量收集器会掩盖包含 `SECRET`、`PASSWORD`、`TOKEN`、`KEY`、`CREDENTIAL` 或 `PRIVATE` 的键的值。对 `KEY` 的子串匹配意味着 `KEYBOARD_LAYOUT`、`KEYRING_BACKEND` 和 `XAUTHORITY_KEY` 都会被掩盖。这可以说是对的——宁可过度掩盖也不要泄露凭证——但它在不敏感的含 `KEY` 变量发生变化时产生嘈杂的 diff。更聪明的方式是后缀匹配（`_KEY`、`_SECRET`），而不是子串匹配。

## 我会怎么做

**从注册表派生 CLI 选项。** `COLLECTOR_NAMES` 的 bug 完全可以避免。如果 CLI 用了 `[cls.name for cls in ALL_COLLECTORS]`，列表就永远是正确的。硬编码的列表去镜像动态注册表是一个维护隐患。

**在并发下测试 blob 存储。** `.tmp` 竞态条件是那种只在生产中出现的 bug。一个简单的测试，用 `concurrent.futures.ThreadPoolExecutor` 让 10 个线程存储同一个 blob，会立即发现它。

**在树里存储 blob 大小。** `getattr` 性能问题是一个根本性的设计问题，不是 bug。树应该把 `path -> (hash, size)` 而不是 `path -> hash` 映射起来。这会让 stat 调用从 O(文件大小) 变成 O(1)，也是 FUSE 模式在任何非玩具项目上可用的前提条件。

**用 `fnmatch` 代替手写的 glob 匹配。** Python 标准库有 `fnmatch.fnmatch`。我手写的版本第一次就有 bug。标准库版本不会有。

---

修复了三个 bug，找出了两个设计问题，写了一篇博客文章。从"我应该审查这段代码"到"完成"的总时间大约是两个小时。这些 bug 都在我自己写的代码里，都是上个月写的。代码审查是有效的——尤其是对你自己的代码——只要你用新鲜的眼光和愿意被自己尴尬到的心态来做。
