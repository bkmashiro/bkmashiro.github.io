---
title: "Shimmy WASM：当安全模型里根本没有 Syscall"
date: 2026-03-09
readingTime: true
outline: [2, 3]
tag:
  - "系统"
  - "安全"
  - "WebAssembly"
  - "Serverless"
description: "我们为 shimmy 构建了一个 WASM 沙箱，带临时执行模式、细粒度 WASI 能力控制，以及一个不需要 syscall 过滤器的安全模型——因为根本没有 syscall。"
---

前两篇文章覆盖了[威胁模型](/zh/projects/serverless-sandbox)和 [seccomp 沙箱](/zh/projects/shimmy-sandbox-research)。这篇讲更进一步：一个基于 WebAssembly 的执行环境，安全属性来自编译目标本身，而不是 OS 级别的过滤器。

## 为什么 WASM 的安全模型不同

用 seccomp，我们写了一个 62 条目的阻断列表。当新的危险 syscall 出现（比如 `io_uring`），就往列表里加。这个安全模型是"阻断坏的东西"。

用 WASM，安全模型是"根本没有 syscall"。一个 `.wasm` 二进制文件没有任何机制去调用 `socket()`、`ptrace()` 或 `io_uring_setup()`——不是因为我们阻断了它们，而是因为这个指令集里根本没有这些指令。所有 I/O 都通过 WASI 进行，而 WASI 是一个由运行时控制的能力接口。

由此产生的安全属性：

| 属性         | 原生代码 |           WASM           |
| ------------ | :------: | :----------------------: |
| 直接 syscall |   可能   |          不可能          |
| 内存损坏     | 可被利用 |    被捕获（边界检查）    |
| ROP/JOP 攻击 |   可能   |   不可能（无代码指针）   |
| 缓冲区溢出   |   危险   |          被捕获          |
| Fork 炸弹    |   可能   | 不可能（WASI 没有 fork） |

你不需要阻断 `fork`——它根本不存在。

## 架构

```
用户代码（C/C++/Rust/Go）
        │
        ▼  clang --target=wasm32-wasi
WASM 二进制（.wasm）
        │
        ▼
Wasmtime 运行时
   ├── WASI 能力（预开放路径、过滤后的环境变量）
   ├── 资源限制（--fuel, --max-memory-size）
   └── 临时文件系统（临时目录，执行后清理）
        │
        ▼
宿主系统（只能看到预开放路径，其他什么都看不到）
```

## WASI 能力模型

WASM 默认什么都得不到。每个能力都必须显式授权：

**安全——可随意授权：**

| 能力           |   默认   | 备注         |
| -------------- | :------: | ------------ |
| `timeout`      |    5s    | 挂钟时间限制 |
| `memory_mb`    |   128    | 线性内存上限 |
| `fuel`         | 10亿指令 | CPU 限制     |
| `allow_clock`  |    ✅    | 时间查询     |
| `allow_random` |    ✅    | 加密 RNG     |

**注意——有限暴露：**

| 能力            | 默认 | 备注             |
| --------------- | :--: | ---------------- |
| `allow_fs_read` |  ❌  | 只读预开放路径   |
| `allow_args`    |  ✅  | argv 对程序可见  |
| `allow_simd`    |  ✅  | 风险：时序侧信道 |

**警告——可能泄漏：**

| 能力        | 默认 | 备注                   |
| ----------- | :--: | ---------------------- |
| `allow_env` |  ❌  | 传递环境变量（过滤后） |

**危险——不可逆副作用：**

| 能力                | 默认 | 备注                         |
| ------------------- | :--: | ---------------------------- |
| `allow_fs_write`    |  ❌  | 仅在 `ephemeral=True` 时安全 |
| `allow_tcp_connect` |  ❌  | 数据外泄风险                 |
| `allow_tcp_listen`  |  ❌  | 网络暴露风险                 |

**不可能——WASI 规范里没有：**

| 能力         | 原因              |
| ------------ | ----------------- |
| 进程创建     | WASI 规范不支持   |
| 信号处理     | WASI 规范不支持   |
| 原始 syscall | 没有 syscall 指令 |
| 宿主内存访问 | 线性内存是隔离的  |

"不可能"这一类才是 WASM 与其他方案本质上不同的地方。你无法授权 `allow_fork`，因为 fork 在这个接口里根本不存在。

## 临时执行模式

默认执行模式不在宿主上留下任何痕迹：

```
1. 创建临时目录：/var/.../shimmy_wasm_abc123/
2. 隔离 /tmp：  shimmy_wasm_abc123/sandbox_tmp/
3. 复制可写目录：/data → abc123/copy_data/（复制，不是挂载）
4. 运行 WASM：  所有写入都进临时副本
5. 收集输出文件：result.output_files = {name: bytes}
6. 删除所有临时文件：临时目录移除，宿主完全干净
```

结果对象捕获程序写入 `/tmp` 的内容，但不持久化到真实文件系统：

```python
result = sandbox.run(wasm_bytes, config)

# 程序输出
print(result.stdout)

# 程序在 /tmp 里创建的文件
for name, data in result.output_files.items():
    print(f"创建了: {name} ({len(data)} 字节)")
# 磁盘上什么都没有。什么都没有。
```

`ephemeral=False` 存在于确实需要持久写入的场景——但这是显式的 opt-in，不是默认行为。

## 性能数据

（50 次运行，5 次预热，macOS arm64）

| 负载               | 原生 | WASM 运行 | WASM 完整\* | 运行时开销 |
| ------------------ | :--: | :-------: | :---------: | :--------: |
| Hello World        | 1ms  |   4–6ms   |  50–100ms   |    4–6x    |
| 计算（10万次操作） | 3ms  |   5–8ms   |  60–110ms   |  1.7–2.7x  |
| Fibonacci(35)      | 50ms | 70–100ms  |  120–200ms  |   1.4–2x   |
| 内存（分配 1MB）   | 2ms  |   4–6ms   |  50–100ms   |    2–3x    |

\*"WASM 完整"包含从源码的编译。"WASM 运行"使用预编译的 `.wasm`。

50–100ms 的编译开销是主要成本。缓解路径：缓存编译好的模块（同一源码 = 同一 `.wasm`）、AOT 预编译、或在提交时而非执行时预编译。

编译完成后的运行时开销是 1.5–3x——对于安全优先的场景可以接受。

### 与其他沙箱方案对比

| 方案                | 启动时间 | 运行时开销 |      逃逸难度      |
| ------------------- | :------: | :--------: | :----------------: |
| **WASM**            |  ~50ms   |    ~2x     | 需要 wasmtime bug  |
| seccomp（Sandlock） |  ~1.5ms  |   ~1.01x   | 利用允许的 syscall |
| Docker              |  ~500ms  |   ~1.05x   |      内核漏洞      |
| gVisor              |  ~200ms  |   ~1.5x    | 虚拟机监控程序漏洞 |
| Firecracker         |  ~125ms  |   ~1.1x    | 虚拟机监控程序漏洞 |

WASM 占据了"启动快"和"最难逃逸"的交集。逃逸需要 wasmtime 本身的 bug——不是过滤器规则里的疏漏，不是策略配置的失误，是运行时的漏洞。攻击面小得多。

## 多线程：刻意不实现

WASM 线程存在。`wasm32-wasi-threads` 是一个编译目标。Wasmtime 支持 `--wasm-threads=y`。我们没有实现它。

原因是 `SharedArrayBuffer` + 高精度时钟 = Spectre。这个组合提供了时序侧信道，当初就是浏览器里 Spectre 攻击的原始向量。浏览器厂商因此大幅降低了时钟精度。

在一个运行不受信任代码的沙箱里，引入这个向量不值得换取并行计算的好处。在代码库里明确记录为刻意决定：

```python
# 多线程（未实现——为完整性记录在此）
# WASM 线程技术上可行：wasm32-wasi-threads + wasmtime --wasm-threads=y
# 未实现原因：Spectre 风险（SharedArrayBuffer + 时序），增加复杂度，沙箱场景无需并行
```

## Lambda 部署配置

```python
config = SandboxConfig(
    timeout=5,
    memory_mb=128,
    fuel=1_000_000_000,
    max_output=65536,

    allow_fs_read=False,
    allow_fs_write=False,
    allow_env=False,
    allow_tcp_connect=False,

    allow_clock=True,
    allow_random=True,
    ephemeral=True,     # 默认就是，但显式写出来更清晰
)
```

这一层给 Lambda 部署包增加约 20MB（wasmtime 二进制 + Python 包装器）。编译时间：冷启动 100–500ms，暖启动 50–100ms。总沙箱调用：暖启动 60–200ms。

## 什么时候用 WASM vs. Sandlock

| 场景                   | 选择             |
| ---------------------- | ---------------- |
| 最高安全要求           | WASM             |
| Lambda 执行            | WASM             |
| Python + numpy/scipy   | Sandlock（目前） |
| 预编译二进制           | Sandlock         |
| 延迟要求 < 2ms         | Sandlock         |
| 跨平台                 | WASM             |
| C/C++/Rust/Go 代码片段 | WASM             |

Python 的限制是真实的：Pyodide 需要浏览器 JS 引擎，MicroPython 标准库受限，RustPython 不完整。在生态成熟之前，Python 代码走 Sandlock。其他所有语言通过 WASM 有更好的安全保障。

## 接下来

1. **模块缓存**——同一源码跳过重新编译
2. **AOT 编译**——预编译为原生代码，提升暖启动性能
3. **Python WASM**——持续关注 MicroPython/WASI-threads 生态；12–18 个月后重新评估
4. **流式编译**——在编译完成之前就开始执行

终点是混合架构：Python 继续走 Sandlock 直到 WASM Python 生态成熟，其他语言现在就走 WASM。
