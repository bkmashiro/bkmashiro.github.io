---
title: "Sandlock v1.4：从单文件到全栈沙箱"
date: 2026-03-09
readingTime: true
outline: [2, 3]
tag:
  - "系统"
  - "安全"
  - "C"
  - "Linux"
description: "Sandlock 最初是一个 822 行的 C 文件，做 seccomp 和 rlimit。到 v1.4.0，它成了一个模块化沙箱系统，拥有 strict mode、语言级沙箱、源码扫描器和完整的攻击防御矩阵。"
---

我一直在记录 `sandbox_exec` 演化成通用工具的过程。这篇文章记录 Sandlock v1.4.0——它从"聪明的包装器"变成"多层安全系统"的那个版本。

**仓库：** [github.com/bkmashiro/Sandlock](https://github.com/bkmashiro/Sandlock)

## 重构：822 行 → 8 个模块

v1.3.0 单文件达到 822 行，维护变得困难。我们把它拆分：

```
src/
├── sandlock.h    (156行)  — 公共类型、配置结构
├── main.c        (261行)  — CLI 解析、fork/exec 编排
├── config.c       (80行)  — 验证、冲突检测
├── strict.c      (350行)  — seccomp notify 路径级控制
├── seccomp.c      (76行)  — BPF 过滤器生成
├── landlock.c    (102行)  — Landlock LSM 文件系统规则
├── rlimits.c      (31行)  — 资源限制
├── pipes.c        (94行)  — I/O 管道处理
└── isolation.c   (110行)  — /tmp 隔离和清理
```

最长的文件从 822 行降到 261 行。`make single` 仍然可以构建单文件版本，方便简单部署。

## v1.3：日志级别

简单但必要——之前 sandlock 的输出要么全有要么全无。

```bash
./sandlock              # INFO（默认）
./sandlock -v           # DEBUG：显示"executing python3"
./sandlock -vv          # TRACE：最详细
./sandlock -q           # WARN：只有错误和警告
./sandlock -qqq         # SILENT：只有子进程输出
```

测试时 `-v` 对于观察 strict mode 拦截器在做什么非常有价值。生产环境用 `-q` 保持 Lambda 日志整洁。

## v1.4：Strict Mode

这是最有意思的部分。现有的 seccomp 过滤器在 syscall 层面工作——"阻断 `socket()`，允许 `read()`"。但如果威胁是通过允许的 `openat()` 读取 `/etc/passwd` 或 `/proc/self/environ`，这就帮不上忙了。

Strict mode 使用 seccomp notify（内核 5.0+，`SECCOMP_FILTER_FLAG_NEW_LISTENER`），在父进程中拦截特定 syscall，而不是直接阻断它们：

```
父进程                          子进程
  │                               │
  │         fork()                │
  │                               │
  │                     安装 seccomp 过滤器
  │                     带 NEW_LISTENER
  │◄──── 发送 notify_fd ─────────┤
  ├──────── "ready" ────────────►│
  │                               │
  ├── notify 处理线程              │  execvp()
  │                               │
  │◄── openat("/etc/passwd") ────┤
  │
  ├── is_path_allowed()?
  │   ├─ YES → SECCOMP_USER_NOTIF_FLAG_CONTINUE
  │   └─ NO  → EACCES
```

用法：

```bash
# 只允许访问 /tmp
./sandlock --strict --allow /tmp -- python3 student.py

# 调试：查看被阻断的内容
./sandlock --strict --allow /tmp -v -- python3 student.py
# sandlock: DEBUG: BLOCKED: openat(/etc/passwd)
# sandlock: DEBUG: BLOCKED: openat(/proc/self/environ)
```

过滤器始终允许执行所需的系统路径（`/bin`、`/lib`、`/lib64`、`/usr/bin`、`/etc/ld.so.*`、`/dev/null`、`/dev/urandom`）。其他路径默认拒绝，除非显式 `--allow`。

## 配置冲突检测

新的 `config.c` 模块在 fork 之前验证配置：

| 冲突                              | 处理                           |
| --------------------------------- | ------------------------------ |
| `--strict` 没有 `--allow`         | 错误——不启动                   |
| `--strict` + `--pipe-io`          | 警告——禁用 pipe-io（死锁风险） |
| `--landlock` + `--strict`         | 警告——两者都工作但冗余         |
| `--isolate-tmp` + `--cleanup-tmp` | 警告——冗余                     |
| `--cpu` > `--timeout`             | 警告——timeout 先触发           |

不兼容选项不再静默失败。

## 语言级沙箱

C 核心处理 OS 层。v1.5.0（同日发布）在此之上添加了语言专用层。

### Python（`lang/python/sandbox.py`）

Import hook + 受限内置函数：

```python
# 这些模块在导入时被阻断：
# socket, ssl, requests, subprocess, os, sys, ctypes, pickle, ...

# 这些内置函数被移除：
# exec, eval, compile, input, open（替换为受限版本）

# 允许的：
# math, json, re, collections, datetime, random, statistics, hashlib
```

受限的 `open()` 只允许读写 `/tmp`。

**已知绕过向量：** `().__class__.__bases__[0].__subclasses__()`——经典的 Python 沙箱逃逸。有部分缓解措施；源码扫描器是更硬的保障。

### JavaScript（`lang/javascript/`）

两个变体：

- **`sandbox.js`**——严格 VM 隔离，使用 Node 的 `vm` 模块，无 process/eval/Function，模块白名单
- **`wrapper.js`**——npm 包可用，在 `require` 层做运行时补丁

### 源码扫描器（`lang/scanner/scanner.py`）

执行前的静态分析，支持 C/C++/Python/JavaScript/Rust/Go：

| 严重性  | 模式              | 示例                         |
| ------- | ----------------- | ---------------------------- |
| 🔴 严重 | 内联汇编          | `asm("syscall")`             |
| 🔴 严重 | 直接 syscall 指令 | `int 0x80`                   |
| 🔴 严重 | 自定义入口点      | `_start()`                   |
| 🟠 高   | FFI/ctypes        | `dlopen`, `cffi`, `ffi-napi` |
| 🟡 中   | 危险函数          | `fork`, `socket`, `eval`     |

这在编译或执行之前运行——唯一能捕获内联汇编中直接 syscall 尝试的层。

### LD_PRELOAD Hook（`lang/preload/sandbox_preload.c`）

用于无法修改源码的已编译二进制：

```bash
LD_PRELOAD=./sandbox_preload.so \
  SANDBOX_NO_NETWORK=1 \
  SANDBOX_NO_FORK=1 \
  SANDBOX_ALLOW_PATH=/tmp \
  ./program
```

钩住了 `socket`、`connect`、`bind`、`fork`、`execve`、`execvp`、`open`、`fopen`。同时阻断 `unsetenv`/`putenv` 防止移除 `LD_PRELOAD`。

**已知绕过：** 静态链接、内联 `syscall()` 汇编。扫描器是对此的防御。

## 完整防御矩阵

模块化设计的真正价值在于各层如何组合。以下是 Full-Stack Sandlock 覆盖的攻击面：

| 攻击             | seccomp | Landlock/Strict | 语言沙箱 | 扫描器 | 结果    |
| ---------------- | :-----: | :-------------: | :------: | :----: | ------- |
| 网络外泄         |   ✅    |        —        |    ✅    |   —    | 🔴 已封 |
| 反向 Shell       |   ✅    |        —        |    ✅    |   —    | 🔴 已封 |
| Fork 炸弹        |   ✅    |        —        |    ✅    |   —    | 🔴 已封 |
| 读 /etc/passwd   |    —    |       ✅        |    ✅    |   —    | 🔴 已封 |
| 写 /tmp 之外     |    —    |       ✅        |    ✅    |   —    | 🔴 已封 |
| ptrace           |   ✅    |        —        |    —     |   —    | 🔴 已封 |
| 内联汇编 syscall |   ✅    |        —        |    —     |   ✅   | 🔴 已封 |
| dlopen/FFI       |   ✅    |        —        |    ✅    |   ✅   | 🔴 已封 |
| 直接 syscall     |   ✅    |        —        |    ⚠️    |   ✅   | 🟡 困难 |
| /proc 信息泄漏   |    —    |       ⚠️        |    ⚠️    |   —    | 🟡 部分 |

剩余缺口——`/proc` 信息泄漏和内核 0day——分别需要 mount namespace 和 OS 级别更新。纯用户态无法解决。

## 内核兼容性

| 功能           | 最低内核 | AWS Lambda (5.10) | 现代 (6.x) |
| -------------- | :------: | :---------------: | :--------: |
| seccomp-bpf    |   3.5    |        ✅         |     ✅     |
| seccomp notify |   5.0    |        ✅         |     ✅     |
| Landlock       |   5.13   |        ❌         |     ✅     |

Lambda 通过 Firecracker 运行内核 5.10——Landlock 不可用，而且 Firecracker 自己施加的 seccomp 过滤器会阻止安装额外的过滤器。Lambda 上的防御栈是：rlimits + 语言沙箱 + LD_PRELOAD + 源码扫描器 + env 清理 + VPC 出口规则。

## 性能

| 配置                              | 开销   |
| --------------------------------- | ------ |
| 最小（seccomp + rlimits）         | ~1.5ms |
| 完整（所有选项）                  | ~2.5ms |
| Strict mode（每次拦截的 syscall） | ~0.1ms |
| Python 沙箱开销                   | ~8ms   |

Python 沙箱的 8ms 开销来自 import hook 在每次 import 时扫描模块名。为了安全值得，但值得知道。

## v1.5.0 的代码规模

整个代码库现在约 4,700 行，跨 C、Python 和 JavaScript：

```
src/*.c + *.h          ~1,500 行
lang/python/           ~320 行
lang/javascript/       ~670 行
lang/scanner/          ~450 行
lang/preload/          ~250 行
tests/                 ~500 行框架 + 48 个攻击测试
```

CI 在 `sandlock.c`/`Makefile` 变更时触发。炸弹测试（fork bomb、内存炸弹、CPU 炸弹）需要手动勾选——它们通过三层 timeout（sandlock 内部 → shell `timeout 10` → GitHub `timeout-minutes: 10`），不会损坏 runner，但仍然设置了门控防止意外触发。
