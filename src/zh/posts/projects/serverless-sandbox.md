---
title: "在 Serverless 中沙箱化学生代码：威胁模型"
description: "当 AWS Lambda 跨学生复用实例时会发生什么？我们梳理了攻击面，对比了沙箱选项，并找到了聪明的变通方案——而且不允许有 root 权限。"
date: 2026-03-07
readingTime: true
tag:
  - 系统
  - 安全
  - Serverless
  - WebAssembly
outline: [2, 3]
---

今天我的 MSc 项目正式启动。前提听起来很简单：在 AWS Lambda 里安全地运行学生代码。约束条件让它变得有趣。

## 问题

[Lambda Feedback](https://github.com/lambda-feedback/shimmy) 是一个平台，学生在这里提交代码并实时得到评测。后端使用 Serverless 函数——AWS Lambda 启动一个容器，运行代码，返回结果。

为了性能，Lambda 会**复用**容器。五分钟前处理了学生 A 提交的函数，可能会处理学生 B 的下一个请求。同一个文件系统，同一个进程内存，同一个 `/tmp`。

这是个问题。

```
[Lambda 实例]
├── /tmp          ← 可写，跨调用持久化
├── 环境变量      ← 可能包含密钥
├── 进程内存      ← Python 模块全局变量在热启动后仍存在
└── 网络          ← 默认出站开放
```

学生 A 可以往 `/tmp` 写文件。学生 B 可以读到它。最坏情况下，学生 A 可以泄露评测器的逻辑或污染评分环境。

## 我们不能做什么

标准的 OS 级隔离行不通：

- **没有 root** → 没有用户命名空间，没有 `unshare`，没有 `nsjail`
- **没有 KVM** → 没有 Firecracker，没有 MicroVM
- **没有 FUSE**（大概）→ 进程级没有覆盖文件系统
- **没有 CAP_BPF** → 排除基于 eBPF 的系统调用过滤（根据 arXiv 2302.10366，这可以减少约 55% 的攻击面）

Lambda 本身会应用自己的 `seccomp-bpf` 过滤器。我们可以在上面叠加，但不能在下面操作。值得注意的是：Lambda 本身运行在 Firecracker MicroVM **里**——所以外层隔离存在，但我们需要在同一个 Lambda 实例内跨学生调用实现**内层**隔离。Firecracker 的 jailer 设计（seccomp + 命名空间 + 文件系统隔离）仍然有参考价值，即使我们无法直接复制。

有一件事我们还不知道：Lambda 实例能不能加载**新的** seccomp 过滤器，还是当用户代码运行时过滤器已经被锁定？这需要实验——我们需要部署一个探针脚本来弄清楚。

## 防御矩阵

以下是可用的工具以及每种工具的覆盖范围：

| 攻击 | seccomp | rlimit | 清理环境变量 | 清理 /tmp |
|------|:-------:|:------:|:-----------:|:--------:|
| Fork 炸弹 | ✅ | ✅ | — | — |
| 内存炸弹 | — | ✅ | — | — |
| 磁盘炸弹 | — | ✅ | — | ✅ |
| /tmp 窥探 | — | — | — | ✅ |
| 环境变量泄露 | ⚠️ | — | ✅ | — |
| /proc 读取 | ⚠️ | — | — | — |
| 反弹 Shell | ✅ | — | — | — |
| 网络渗出 | ✅ | — | — | — |
| setuid | ✅ | — | — | — |

缺口：`/proc` 读取和环境变量泄露。`seccomp` 无法阻断 `getenv()`——那是内存读取，不是系统调用。用 BPF 参数检查过滤 `/proc` 既脆弱又复杂。

**90% 的覆盖率是可以实现的。剩下的 10% 需要创意。**

## 聪明的变通方案

### 1. `LD_PRELOAD` 拦截

不需要内核访问。编译一个包装 `open()` 的垫片：

```c
// 在 libc 层拦截文件打开操作
int open(const char *path, int flags, ...) {
    if (strstr(path, "/proc") || strstr(path, "/var/task"))
        return -EACCES;
    return real_open(path, flags, ...);
}
```

```bash
LD_PRELOAD=/lib/shimmy_sandbox.so python3 student_submission.py
```

学生代码调用 `open("/proc/self/environ")` → 被拒绝。不需要修改内核。在 `LD_PRELOAD` 没被剥离的地方都有效。

缺点：了解此机制的学生可以绕过它（直接调用 `syscall()`）。这是纵深防御，不是硬边界。

### 2. 环境变量清理

最简单的环境变量泄露修复方案：

```python
clean_env = {
    "PATH": "/usr/bin:/usr/local/bin",
    "HOME": "/tmp/student",
    "LANG": "en_US.UTF-8",
    # 其他全部清除 — 不保留 AWS_* 和密钥
}
subprocess.run(["python3", "submission.py"], env=clean_env)
```

零开销。应该是任何方案的基线。

### 3. WebAssembly（终极方案）

在 WASM 运行时中运行学生代码。Pyodide 将 CPython 编译为 WASM；Wasmer/Wasmtime 提供宿主。

```
学生代码 → Pyodide → WASM 线性内存 → Wasmtime
                                        ↑
                              没有系统调用。没有文件系统。
                              所有 I/O 通过宿主导入。
```

这解决了所有问题——`/proc`、环境变量、网络，全部。WASM 实例对宿主文件系统没有任何概念。

代价：Pyodide 增加 ~30MB 并且启动需要数秒。对于一个看重快速反馈的平台，这是真实的开销。但它是唯一能关闭所有缺口的选项。

## 推荐方案栈

目前：**fork + seccomp + rlimit + 环境变量清理**。

```
Lambda 调用
  └── fork() 新进程
        ├── 应用 seccomp-bpf 过滤器（屏蔽危险系统调用）
        ├── 应用 rlimit（CPU、内存、打开文件数）
        ├── 清理环境变量（去除 AWS_*，只保留 PATH/HOME/LANG）
        ├── 清理 /tmp
        └── exec 学生代码
```

这以低复杂度、无需 root、合理的性能开销覆盖了约 90% 的威胁面。

WASM 列入路线图，作为工具链支持的语言的长期路径。Python 是优先级——Pyodide 已足够成熟可用于生产。

## shimmy 集成点

在动手之前，我们先梳理了 [shimmy](https://github.com/lambda-feedback/shimmy)——管理 Lambda Feedback 评测函数的 Go 垫片。当前状态：它完全没有沙箱。Worker 生命周期（spawn → evaluate → respond → idle）是我们添加隔离的自然集成点。

fork-per-invocation 方案可以干净地接入这里：shimmy 已经在管理 Worker 进程。我们可以在调用路径上钩入，在子进程中 fork、应用 seccomp 和 rlimit、运行学生代码，然后丢弃进程。

## 未解决的问题

威胁模型很清楚；一些实现问题还不明确：

1. **我们能在 Lambda 里加载新的 seccomp 过滤器吗？** Lambda 现有的过滤器可能已经用 `SECCOMP_FILTER_FLAG_TSYNC` 锁定。只有实验才能告诉我们答案。
2. **`fork()` 有频率限制吗？** Lambda 可能会限制进程创建。如果是这样，我们需要带重置功能的 Worker 池，而不是真正的 fork-per-invocation。
3. **`prctl()` 能帮上忙吗？** `PR_SET_NO_NEW_PRIVS` 是我们几乎可以肯定能在无 root 情况下应用的低开销强化步骤。
4. **Pyodide 在 Lambda 内存限制下可行吗？** Pyodide 给进程增加约 30MB。Lambda 默认是 128MB，比较紧张。

## 下一步

- 部署探针脚本到真实 Lambda：映射实际可用的系统调用、能力和内核特性
- 读论文：[Firecracker (NSDI'20)](https://www.usenix.org/system/files/nsdi20-paper-agache.pdf)、系统调用插值综述（[arXiv 2302.10366](https://arxiv.org/abs/2302.10366)）
- 在 shimmy 调用路径里原型化 `fork() + seccomp + rlimit`
- 基准测试开销（隔离代价）vs 安全收益
- 两周后导师会议

这里有趣的约束——仅限用户空间，不修改 OS——迫使我们寻找创意解法。这就是它成为研究项目而不是配置问题的原因。
