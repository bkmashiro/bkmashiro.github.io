---
title: "Shimmy WASM: When the Security Model Has No Syscalls"
date: 2026-03-09
readingTime: true
outline: [2, 3]
tag:
  - "Systems"
  - "Security"
  - "WebAssembly"
  - "Serverless"
description: "We built a WASM-based sandbox for shimmy with ephemeral mode, fine-grained WASI capabilities, and a security model that doesn't need syscall filters — because there are no syscalls."
---

The previous two posts covered [the threat model](/posts/serverless-sandbox) and [the seccomp sandbox](/posts/shimmy-sandbox-research). This one is about going further: a WebAssembly execution environment where the security properties come from the compilation target, not from OS-level filters.

## Why WASM Security is Different

With seccomp, we wrote a 62-entry blocklist. When a new dangerous syscall appears (looking at you, `io_uring`), we add it to the list. The security model is "block the bad things."

With WASM, the security model is "there are no syscalls." A `.wasm` binary has no mechanism to call `socket()`, `ptrace()`, or `io_uring_setup()` — not because we blocked them, but because the instruction set doesn't include them. All I/O goes through WASI, which is a capability-based interface controlled by the runtime.

The properties that flow from this:

| Property          | Native Code |             WASM              |
| ----------------- | :---------: | :---------------------------: |
| Direct syscalls   |  Possible   |          Impossible           |
| Memory corruption | Exploitable |   Trapped (bounds-checked)    |
| ROP/JOP attacks   |  Possible   | Impossible (no code pointers) |
| Buffer overflow   |  Dangerous  |            Trapped            |
| Fork bomb         |  Possible   | Impossible (no fork in WASI)  |

You don't need to block `fork` — it doesn't exist.

## Architecture

```
User Code (C/C++/Rust/Go)
        │
        ▼  clang --target=wasm32-wasi
WASM Binary (.wasm)
        │
        ▼
Wasmtime Runtime
   ├── WASI capabilities (preopened paths, filtered env)
   ├── Resource limits (--fuel, --max-memory-size)
   └── Ephemeral filesystem (temp dir, cleaned after run)
        │
        ▼
Host System (sees nothing except preopened paths)
```

## WASI Capability Model

WASM gets nothing by default. Every capability must be explicitly granted. The full matrix:

**Safe — grant freely:**

| Capability     |     Default     | Notes             |
| -------------- | :-------------: | ----------------- |
| `timeout`      |       5s        | Wall-clock limit  |
| `memory_mb`    |       128       | Linear memory cap |
| `fuel`         | 1B instructions | CPU limit         |
| `allow_clock`  |       ✅        | Time queries      |
| `allow_random` |       ✅        | Cryptographic RNG |

**Caution — limited exposure:**

| Capability      | Default | Notes                      |
| --------------- | :-----: | -------------------------- |
| `allow_fs_read` |   ❌    | Read preopened paths only  |
| `allow_args`    |   ✅    | argv visible to program    |
| `allow_simd`    |   ✅    | Risk: timing side-channels |

**Warning — potential leaks:**

| Capability  | Default | Notes                      |
| ----------- | :-----: | -------------------------- |
| `allow_env` |   ❌    | Passes env vars (filtered) |

**Dangerous — irreversible side effects:**

| Capability          | Default | Notes                           |
| ------------------- | :-----: | ------------------------------- |
| `allow_fs_write`    |   ❌    | Only safe with `ephemeral=True` |
| `allow_tcp_connect` |   ❌    | Data exfiltration risk          |
| `allow_tcp_listen`  |   ❌    | Network exposure                |

**Impossible — WASI doesn't have these:**

| Capability         | Reason                    |
| ------------------ | ------------------------- |
| Process spawn      | Not in WASI spec          |
| Signal handling    | Not in WASI spec          |
| Raw syscalls       | No syscall instruction    |
| Host memory access | Linear memory is isolated |

The impossible category is what makes WASM fundamentally different. You can't grant `allow_fork` because fork doesn't exist in the interface.

## Ephemeral Mode

The default execution mode leaves no trace on the host:

```
1. Create temp directory: /var/.../shimmy_wasm_abc123/
2. Isolate /tmp:          shimmy_wasm_abc123/sandbox_tmp/
3. Copy writable dirs:    /data → abc123/copy_data/  (copy, not mount)
4. Run WASM:              all writes go to temp copies
5. Collect output files:  result.output_files = {name: bytes}
6. Delete everything:     temp dir removed, host unchanged
```

The result object captures what the program wrote to `/tmp` without any of it persisting to the real filesystem:

```python
result = sandbox.run(wasm_bytes, config)

# Program output
print(result.stdout)

# Files the program created in /tmp
for name, data in result.output_files.items():
    print(f"Created: {name} ({len(data)} bytes)")
# Nothing on disk. Nothing.
```

`ephemeral=False` exists for cases where you actually want the writes — but it's an explicit opt-in, not the default.

## Performance Numbers

The honest benchmark (50 runs, 5 warmup, macOS arm64):

| Workload           | Native | WASM run | WASM full\* | Runtime overhead |
| ------------------ | :----: | :------: | :---------: | :--------------: |
| Hello World        |  1ms   |  4–6ms   |  50–100ms   |       4–6x       |
| Compute (100k ops) |  3ms   |  5–8ms   |  60–110ms   |     1.7–2.7x     |
| Fibonacci(35)      |  50ms  | 70–100ms |  120–200ms  |      1.4–2x      |
| Memory (1MB alloc) |  2ms   |  4–6ms   |  50–100ms   |       2–3x       |

\*"WASM full" includes compilation from source. "WASM run" uses pre-compiled `.wasm`.

The 50–100ms compilation overhead is the main cost. Mitigation paths: cache compiled modules (same source = same `.wasm`), AOT precompilation, or pre-compile at submission time rather than execution time.

Runtime overhead once compiled is 1.5–3x — acceptable for a security-first context.

### vs. Other Sandboxing Approaches

| Approach           | Startup | Runtime overhead |   Escape difficulty   |
| ------------------ | :-----: | :--------------: | :-------------------: |
| **WASM**           |  ~50ms  |       ~2x        | Requires wasmtime bug |
| seccomp (Sandlock) | ~1.5ms  |      ~1.01x      | Allowed-syscall abuse |
| Docker             | ~500ms  |      ~1.05x      |    Kernel exploit     |
| gVisor             | ~200ms  |      ~1.5x       |  Hypervisor exploit   |
| Firecracker        | ~125ms  |      ~1.1x       |  Hypervisor exploit   |

WASM occupies the intersection of "fast startup" and "hardest to escape." The escape requires a bug in wasmtime itself — not in the filter rules, not in the policy configuration, in the runtime. That's a much smaller attack surface.

## Threading: Deliberately Not Implemented

WASM threads exist. `wasm32-wasi-threads` is a compilation target. Wasmtime supports `--wasm-threads=y`. We're not implementing it.

The reason is `SharedArrayBuffer` + high-precision clock = Spectre. The combination provides a timing side-channel that was the original vector for Spectre attacks in browsers. Browser vendors went to significant lengths to reduce clock precision after this discovery.

In a sandbox where you're running untrusted code, adding that vector isn't worth the parallelism benefit. Documented in the codebase as intentional:

```python
# Threading (NOT IMPLEMENTED - documented for completeness)
# WASM threads are possible via wasm32-wasi-threads + wasmtime --wasm-threads=y
# Not implemented: Spectre risk (SharedArrayBuffer + timing), complexity, no benefit for sandboxed snippets
```

## Lambda Deployment

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
    ephemeral=True,     # default, but be explicit
)
```

The layer adds ~20MB to the Lambda deployment (wasmtime binary + Python wrapper). Compilation time varies: 100–500ms cold, 50–100ms warm. Total sandbox invocation: 60–200ms warm.

## When WASM vs. Sandlock

| Use Case                 | Choose             |
| ------------------------ | ------------------ |
| Maximum security         | WASM               |
| Lambda execution         | WASM               |
| Python with numpy/scipy  | Sandlock (for now) |
| Pre-compiled binaries    | Sandlock           |
| <2ms latency requirement | Sandlock           |
| Cross-platform           | WASM               |
| C/C++/Rust/Go snippets   | WASM               |

The Python caveat is real: Pyodide requires a browser JS engine, MicroPython has limited stdlib, RustPython is incomplete. Until that ecosystem matures, Python code goes through Sandlock. Everything else has a better security story via WASM.

## What's Next

1. **Module caching** — same source → skip recompilation
2. **AOT compilation** — precompile to native code for better warm performance
3. **Python WASM** — watch the MicroPython/WASI-threads ecosystem; reassess in 12–18 months
4. **Streaming compilation** — start execution before compilation finishes

The endpoint is a hybrid: Python through Sandlock until the WASM Python ecosystem matures, everything else through WASM now.
