---
title: "WASM vs seccomp: Benchmarking Sandbox Startup for a Code Grader"
description: "We measured every millisecond of WebAssembly sandbox startup across six scenarios — and compared it against the seccomp approach we shipped last week. Spoiler: WASM is better at security, worse at Python."
date: 2026-03-09
readingTime: true
tag:
  - Systems
  - Security
  - WebAssembly
  - Performance
outline: [2, 3]
---

Last week we shipped `sandbox_exec` — a 224-line C program using seccomp-bpf to isolate student code in AWS Lambda. The honest answer at the time was: "WASM would be cleaner, but the Python ecosystem isn't there yet."

This week we measured exactly what "the Python ecosystem isn't there yet" costs in milliseconds. The answer is more nuanced than expected.

## Setup

- Runtime: Wasmtime v42.0.1
- Platform: macOS arm64
- Methodology: 50 runs per scenario, 5 warmup runs, averaged
- Comparison: sandbox_exec wrapping Python 3.x

## Phase 1: Startup Overhead

The first question is simple: how long does it take for the sandbox to start with trivial code?

| Environment            | Mean    | P95     |
| ---------------------- | ------- | ------- |
| WASM (JIT)             | 9.79ms  | 10.86ms |
| WASM (AOT precompiled) | 9.25ms  | 10.14ms |
| Python (no sandbox)    | 14.71ms | 15.29ms |

WASM starts faster than Python itself. That's the counterintuitive result here — people assume "VM = slow" but Wasmtime's startup is tighter than CPython's interpreter initialization.

The breakdown of those ~10ms:

```
0–2ms:   fork() + exec(wasmtime)
2–7ms:   Wasmtime runtime init
         ├── command-line parsing
         ├── config loading
         └── WASI environment setup
7–9ms:   WASM module processing
         ├── file read
         ├── validation (type checking)
         └── JIT compilation
9–10ms:  execution + cleanup
```

Most of the time is in Wasmtime's own initialization, not module parsing or JIT.

## Phase 2: Does Module Size Matter?

| Module size | Time    | Delta    |
| ----------- | ------- | -------- |
| ~100B       | 9.58ms  | baseline |
| ~4KB        | 9.68ms  | +0.1ms   |
| ~40KB       | 10.97ms | +1.4ms   |

A 400x increase in module size costs 1.4ms. The initialization cost dominates everything else.

## Phase 3: Compute Performance

This is where WASM's JIT advantage becomes visible.

| Workload | WASM    | Python   | Speedup  |
| -------- | ------- | -------- | -------- |
| fib(10)  | 10.06ms | 15.12ms  | 1.5x     |
| fib(20)  | 9.63ms  | 16.80ms  | 1.7x     |
| fib(25)  | 10.77ms | 25.94ms  | 2.4x     |
| fib(30)  | 15.91ms | 128.97ms | **8.1x** |

At fib(30), WASM total time is ~16ms (10ms startup + 6ms compute). Python takes 129ms. The crossover point where WASM becomes faster overall is somewhere around fib(20-25) — roughly where computation stops being negligible relative to startup.

For a homework grader evaluating algorithmic submissions, this gap matters.

## Phase 4: I/O Overhead

| Operation     | WASM    | Python  |
| ------------- | ------- | ------- |
| 1× fd_write   | 10.16ms | 15.15ms |
| 100× fd_write | 9.97ms  | 15.23ms |

100 write operations takes the same time as 1. The startup cost dominates completely, and WASI I/O overhead is negligible once you're inside the runtime.

## Phase 5: Memory Allocation

| Memory | Time    |
| ------ | ------- |
| 64KB   | 9.62ms  |
| 1MB    | 9.86ms  |
| 4MB    | 10.04ms |
| 16MB   | 9.74ms  |

WASM uses lazy allocation. Declaring 16MB of memory costs almost nothing at startup.

## Phase 6: Security Features Have No Cost

| Config                      | Time    | Notes           |
| --------------------------- | ------- | --------------- |
| No limits                   | 9.58ms  | baseline        |
| +fuel (instruction counter) | 7.94ms  | slightly faster |
| +memory limit               | 7.76ms  | slightly faster |
| +directory preopen          | 10.50ms | +0.9ms          |
| All limits                  | 7.91ms  |                 |

Adding fuel and memory limits is _faster_ than not having them — likely because they trigger an optimized execution path. The only measurable cost is directory preopen (+0.9ms for filesystem capability setup).

**Security here has negative overhead.** That's unusual.

## The Security Model Gap

Performance aside, the security comparison is stark:

| Dimension        |       sandbox_exec        |             WASM              |
| ---------------- | :-----------------------: | :---------------------------: |
| Isolation level  |          Process          |              VM               |
| Memory isolation |   Shared address space    | Linear memory (hard boundary) |
| Syscall control  |     seccomp allowlist     |      No syscalls at all       |
| Filesystem       | External cleanup required |       Capability-gated        |
| Network          |      seccomp-blocked      |       Absent by default       |

WASM doesn't filter syscalls — it doesn't have syscalls. A WASM module running under WASI cannot call `socket()`, `ptrace()`, or `io_uring_setup()` because there's no mechanism to make those calls. They don't exist from inside the sandbox.

This is a fundamentally stronger guarantee than seccomp's allowlist. With seccomp, you're saying "block these 62 syscalls." With WASM, you're saying "there are no syscalls." The attack surface difference is categorical.

## Why We're Not Using WASM Yet

The security model is better. The compute performance is better for CPU-bound code. The startup overhead is comparable.

The problem is Python:

| Python WASM runtime | Size  | C extensions | Verdict                      |
| ------------------- | ----- | :----------: | ---------------------------- |
| MicroPython         | 370KB |      ❌      | Limited stdlib               |
| RustPython          | ~5MB  |   Partial    | Incomplete                   |
| Pyodide             | ~15MB |      ✅      | Browser-only, 500ms+ startup |

The homework grader needs numpy, scipy, and arbitrary C extensions. Pyodide supports these but requires a browser JavaScript engine — it won't run under Wasmtime. MicroPython and RustPython don't support the full scientific Python stack.

This isn't a performance problem. It's an ecosystem problem. The WASM Python toolchain is evolving fast, but it's not there for "run arbitrary student numpy code" yet.

## The Roadmap

```
Now:      sandbox_exec (seccomp + rlimit)
          └── Full Python + C extensions
          └── ~1.5ms sandbox + ~15ms Python startup
          └── 62 blocked syscalls

1–2 years: WASM for non-Python languages
           └── JS, Rust, Go students → WASM directly
           └── Better security, comparable performance

2–3 years: WASM Python when ecosystem matures
           └── Component Model + WASI Preview 2
           └── Hybrid: Python → sandbox_exec, others → WASM
```

The hybrid architecture is the likely end state: seccomp for Python (where C extension support is non-negotiable), WASM for everything else (where the ecosystem is already mature).

## Numbers Summary

If you're evaluating WASM for a similar use case:

- **Startup:** ~10ms (comparable to or faster than Python startup itself)
- **JIT compute:** 2–8x faster than CPython for CPU-bound code
- **Security overhead:** Zero (security features are free or negative-cost)
- **Python compatibility:** Not yet viable if you need numpy/scipy/C extensions
- **Everything else:** Already viable

The 10ms startup cost is not the blocker. The Python ecosystem is.

---

_Benchmarks by Akashi (CTO). All measurements: Wasmtime v42.0.1, macOS arm64, 50-run averages._
