---
title: "为学生代码构建用户态沙箱：三小时红队对抗实录"
description: "我们用 seccomp-bpf 和 rlimit 写了一个 224 行的 C 沙箱，然后花三小时尝试攻破它。以下是完整记录。"
date: 2026-03-09
readingTime: true
tag:
  - 系统
  - 安全
  - C
  - Serverless
outline: [2, 3]
---

**更新 2026-03-09：** `sandbox_exec` 已演化为 **Sandlock**——模块化全栈沙箱，增加了 strict mode、语言级沙箱（Python/JS）、源码扫描器和 LD_PRELOAD hook。参见 [Sandlock v1.4：从单文件到全栈沙箱](/zh/projects/sandlock-v14) 和 [GitHub 仓库](https://github.com/bkmashiro/Sandlock)。

---

上周我写了在 AWS Lambda 里运行学生代码的[威胁模型](/zh/projects/serverless-sandbox)。这周我们把它造出来，然后亲手去打它。

结果是 `sandbox_exec`：一个 224 行的 C 程序，用 seccomp-bpf 过滤器包裹学生提交的代码，加上资源限制，经过五轮红队对抗验证。

## 为什么不用 WASM 或 Namespace？

在写第一行代码之前，我们评估了三条路：

| 方案                   | 隔离级别 | 延迟     | Lambda 可用 | Python 支持 |
| ---------------------- | -------- | -------- | ----------- | ----------- |
| **seccomp（用户态）**  | 进程     | ~1.5ms   | ✅          | ✅ 完整     |
| Namespace（需 root）   | 容器     | ~5ms     | ❌          | ✅ 完整     |
| WebAssembly（Pyodide） | 虚拟机   | ~10–50ms | ✅          | ⚠️ 受限     |

Lambda 没有 root，没有 KVM。Namespace 方案直接排除。WebAssembly 的 Pyodide 启动开销是真实存在的，而且 numpy、scipy 这类 C 扩展无法干净地编译到 WASM——对一个数学作业评测器来说这是硬伤。

seccomp 路线胜出：快、无 root 需求、完整 Python 支持。

## sandbox_exec 做了什么

核心是一个用 C 写的 fork-exec 包装器。在 `exec` 启动学生进程之前，它依次：

1. 设置 `PR_SET_NO_NEW_PRIVS` — 子进程永远无法获得比父进程更高的权限
2. 禁止 core dump — 不产生可能泄漏评测内容的内存快照
3. 调用 `setpgid`/`setsid` — 进程组隔离，防止 `kill(-1)` 波及其他 Lambda worker
4. 设置 rlimit（CPU: 5s，内存: 256MB，文件: 10MB，FD: 100，进程数: 10）
5. 加载 seccomp-bpf 过滤器
6. 调用 `exec` — 过滤器从此锁定，无法修改

seccomp 过滤器阻断了 62 类 syscall：

```
网络:  socket, connect, bind, listen, accept, sendto/recvfrom, socketpair
进程:  ptrace, process_vm_readv/writev, clone(无 THREAD flag)
内核:  io_uring_*, bpf, userfaultfd, perf_event_open
文件:  mount, umount2, symlink, link, chroot, pivot_root
系统:  reboot, kexec_*, *module, acct, swap*, set*name
硬件:  ioperm, iopl, modify_ldt
```

默认动作是 `SECCOMP_RET_KILL_PROCESS`——不是杀线程，是杀整个进程。

## 五轮红队对抗

我们没有只写单元测试。我们对沙箱本身进行了五轮主动对抗测试，每次修复发现的问题。

**第一轮：** `ptrace` 附加父进程。学生可以附加到 Lambda worker 并读取其内存——包括期望答案。修复：阻断 `ptrace`。

**第二轮：** 发现两个漏洞。TOCTOU 符号链接竞态（创建文件，在评测器读之前替换成符号链接）→ 阻断 `symlink`。`inotify` 监控（监视评测器写入期望输出）→ 阻断 `inotify_*` 和 `fanotify_*`。

**第三轮：** `personality(READ_IMPLIES_EXEC)` — 翻转一个标志位，让所有可读页面变成可执行，大幅降低 shellcode 难度。修复：阻断 `personality`。

**第四轮：** `kill(-1)` 向当前 session 的所有进程发送 SIGKILL。修复：限制 `kill` 只能作用于自身进程组。

**第五轮：** 没有新漏洞。

**最终结果：** 60 个威胁测试，100% 通过率，每次调用约 1.5ms 开销。

## 我们接受的缺口

有些问题在没有 root 的用户态无法彻底解决。

**`/proc` 信息泄漏：** 学生代码可以读取 `/proc/self/maps`、`/proc/1/environ`、`/proc/net/tcp`。彻底封堵需要 mount namespace。我们用 `--clean-env`（exec 前剥离 `AWS_*` 等敏感环境变量）来缓解，并记录为已知限制。

**`/dev/shm` 持久化：** 共享内存可能跨 Lambda invocation 存活。这个问题在 shimmy 的编排层（而非沙箱本身）处理——每次 eval 前清理一次。

**NPROC 计数：** Linux 按用户统计进程数，不按容器。Fork 炸弹触发 `RLIMIT_NPROC` 后可能影响同 Lambda 实例的其他 worker。我们依赖 Lambda 容器级别的外层隔离。

## 我们没测试的（以及为什么没关系）

有一类风险我们无法测试：内核 0day、推测执行攻击（Spectre/Meltdown）、未知 syscall 交互。

坦率地说：这些风险存在，我们接受它们。威胁模型是学生作业评测器，不是银行。发现并利用一个 Lambda 内核 0day 的成本，远远高于偷一份自动评测期望输出的价值。

我们的风险等式：

```
风险 = 威胁 × 脆弱性 × 影响

威胁:      有怨气的学生（低动机）
脆弱性:    已最小化（5 层防御）
影响:      作业分数（低价值）
```

红队讨论中的原话：_"能做到这件事的人，不会来攻击作业评测系统。"_

## 如何集成到 shimmy

沙箱以薄包装层的形式嵌入 shimmy 现有的 `exec.Command`：

```go
// internal/execution/worker/worker_unix.go
cmd := exec.Command("sandbox_exec",
    "--no-fork", "--no-network", "--clean-env",
    "--cpu", "5", "--mem", "256",
    "--", "python3", studentCode)
```

加上每次调用前的清理步骤：

```bash
rm -rf /tmp/* /var/tmp/* /dev/shm/*
```

## 下一步

这个阶段结束了。seccomp 沙箱很好地覆盖了 Lambda 约束下的威胁面。剩余工作：

- **Lambda 真实环境测试** — 目前所有测试都在 Docker 模拟环境里，需要在真实 Lambda 实例上验证 seccomp 行为（AWS 账号激活中）
- **向 shimmy 提 PR** — C 代码和 Go 集成需要合并进主仓库
- **WebAssembly 研究** — WASM 目前是局限，但对于不依赖 C 扩展的场景（纯 Python、JS）值得深入——它能彻底关闭 `/proc` 和环境变量泄漏的缺口，代价是 Pyodide 的启动时间

---

_研究由明石（CTO）主导。所有红队测试均在隔离 Docker 容器内进行。_
