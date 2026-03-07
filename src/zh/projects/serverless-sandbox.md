---
title: "在 Serverless 中隔离学生代码：一份威胁模型"
description: "当 AWS Lambda 复用实例时会发生什么？我们绘制了攻击面全图，对比了沙箱方案，并在零 root 权限的约束下找到了一些有趣的解法。"
date: 2026-03-07
readingTime: true
tag:
  - 系统
  - 安全
  - Serverless
  - WebAssembly
outline: [2, 3]
---

今天我的 MSc 毕业项目正式启动。需求听起来简单：在 AWS Lambda 里安全地运行学生提交的代码。约束让这件事变得有趣。

## 问题

[Lambda Feedback](https://github.com/lambda-feedback/shimmy) 是 Imperial College 用于学生在线提交和评测代码的平台，底层使用 serverless functions 执行代码。

为了性能，Lambda 会**复用容器**。五分钟前处理过 A 同学提交的实例，下一个请求可能是 B 同学的。同一个文件系统，同一个进程内存，同一个 `/tmp`。

这是个问题。

```
[Lambda 实例]
├── /tmp          ← 可写，跨 invocation 持久
├── 环境变量       ← 可能包含 secrets
├── 进程内存       ← Python 模块全局变量在 warm start 中存活
└── 网络           ← outbound 默认开放
```

A 同学可以往 `/tmp` 写文件，B 同学可以读到。极端情况下，A 同学能拿到评测逻辑，或者污染评分环境。

## 我们做不了什么

标准的 OS 级隔离全部行不通：

- **没有 root** → 没有 user namespaces，没有 `unshare`，没有 `nsjail`
- **没有 KVM** → 没有 Firecracker，没有 microVM
- **没有 FUSE**（大概率）→ 无法在进程级别做 overlay 文件系统

Lambda 本身已经加了一层 `seccomp-bpf` 过滤器。我们可以叠加，但无法绕过。

## 防护矩阵

在可用工具和可防御攻击之间做个映射：

| 攻击类型     | seccomp | rlimit | env 清洗 | /tmp 清理 |
| ------------ | ------- | ------ | -------- | --------- |
| Fork 炸弹    | ✅      | ✅     | —        | —         |
| 内存炸弹     | —       | ✅     | —        | —         |
| 磁盘炸弹     | —       | ✅     | —        | ✅        |
| /tmp 窥探    | —       | —      | —        | ✅        |
| 环境变量泄漏 | ⚠️      | —      | ✅       | —         |
| /proc 读取   | ⚠️      | —      | —        | —         |
| 反向 Shell   | ✅      | —      | —        | —         |
| 网络外传     | ✅      | —      | —        | —         |
| setuid       | ✅      | —      | —        | —         |

缺口：`/proc` 读取和环境变量泄漏。`seccomp` 挡不住 `getenv()`——那是内存读取，不是 syscall。用 BPF 参数过滤 `/proc` 访问又太脆，容易误杀。

**90% 的覆盖是可以做到的。剩下的 10% 需要点创意。**

## 奇技淫巧

### 1. `LD_PRELOAD` 劫持

不需要内核权限。编译一个包装 `open()` 的 shim：

```c
int open(const char *path, int flags, ...) {
    if (strstr(path, "/proc") || strstr(path, "/var/task"))
        return -EACCES;
    return real_open(path, flags, ...);
}
```

```bash
LD_PRELOAD=/lib/shimmy_sandbox.so python3 student_submission.py
```

学生代码调用 `open("/proc/self/environ")` → 被拒绝。不需要修改内核，在任何没有剥离 `LD_PRELOAD` 的环境里都能工作。

缺点：了解这个机制的学生可以绕过（直接调 `syscall()`）。这是纵深防御的一层，不是硬边界。

### 2. 环境变量清洗

修复环境变量泄漏最简单的办法：

```python
clean_env = {
    "PATH": "/usr/bin:/usr/local/bin",
    "HOME": "/tmp/student",
    "LANG": "en_US.UTF-8",
    # 其余全部剥离，尤其是 AWS_*
}
subprocess.run(["python3", "submission.py"], env=clean_env)
```

零额外开销，应该是任何方案的基线。

### 3. WebAssembly（核弹选项）

把学生代码跑在 WASM runtime 里。Pyodide 把 CPython 编译到 WASM，Wasmer/Wasmtime 提供宿主环境：

```
学生代码 → Pyodide → WASM 线性内存 → Wasmtime
                                      ↑
                          没有 syscall，没有文件系统
                          所有 I/O 走 host imports
```

这个方案关闭了所有缺口——`/proc`、环境变量、网络，全部不存在。WASM 实例对宿主文件系统毫无概念。

代价：Pyodide 大约 30MB，启动要几秒。对于追求快速反馈的平台来说是真实的开销。但这是唯一能封住所有漏洞的方案。

## 推荐方案

当前阶段：**fork + seccomp + rlimit + 环境变量清洗**。

```
Lambda invocation
  └── fork() 新进程
        ├── 叠加 seccomp-bpf 过滤器（拒绝危险 syscall）
        ├── 设置 rlimit（CPU、内存、文件描述符上限）
        ├── 清洗 env（剥离 AWS_*，只保留 PATH/HOME/LANG）
        ├── 清空 /tmp
        └── exec 学生代码
```

低复杂度、无 root 依赖、性能开销合理，覆盖约 90% 的威胁面。

WASM 放进路线图，作为支持语言工具链完善后的长期方向。Python 优先——Pyodide 已经够成熟了。

## 接下来

- 读论文：[Firecracker (NSDI'20)](https://www.usenix.org/system/files/nsdi20-paper-agache.pdf)，syscall interposition 综述
- 搞清楚 shimmy 的现有架构，动代码之前先看懂
- 实测 Lambda 里 seccomp 实际放行了哪些 syscall（经验数据比假设可靠）
- 两周后约 supervisor meeting

「只能用 userspace、不能碰 OS」这个约束逼着你想创意解法。这也是它是一个研究课题而不是配置问题的原因。
