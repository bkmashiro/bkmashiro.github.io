---
title: "Sandboxing Student Code in Serverless: A Threat Model"
description: "What happens when AWS Lambda reuses instances across students? We mapped the attack surface, compared sandbox options, and found clever workarounds — with no root access allowed."
date: 2026-03-07
readingTime: true
tag:
  - Systems
  - Security
  - Serverless
  - WebAssembly
outline: [2, 3]
---

Today my MSc project officially kicked off. The premise sounds simple: run student code safely inside AWS Lambda. The constraints make it interesting.

## The Problem

[Lambda Feedback](https://github.com/lambda-feedback/shimmy) is a platform where students submit code and get it evaluated in real time. The backend uses serverless functions — AWS Lambda spins up a container, runs the code, returns the result.

For performance, Lambda _reuses_ containers. A function that handled Student A's submission five minutes ago might handle Student B's next. Same filesystem, same process memory, same `/tmp`.

That's a problem.

```
[Lambda Instance]
├── /tmp          ← writable, persistent across invocations
├── env vars      ← might contain secrets
├── process memory ← Python module globals survive warm starts
└── network       ← outbound open by default
```

Student A can write a file to `/tmp`. Student B can read it. In the worst case, Student A can exfiltrate the evaluator's logic or poison the grading environment.

## What We Can't Do

Standard OS-level isolation is off the table:

- **No root** → no user namespaces, no `unshare`, no `nsjail`
- **No KVM** → no Firecracker, no microVMs
- **No FUSE** (probably) → no overlay filesystems at the process level

Lambda already applies a `seccomp-bpf` filter of its own. We can layer on top of it, but we can't go beneath it.

## The Defense Matrix

Here's what's available and what each tool covers:

| Attack        | seccomp | rlimit | env cleanup | /tmp clear |
| ------------- | ------- | ------ | ----------- | ---------- |
| Fork bomb     | ✅      | ✅     | —           | —          |
| Memory bomb   | —       | ✅     | —           | —          |
| Disk bomb     | —       | ✅     | —           | ✅         |
| /tmp snooping | —       | —      | —           | ✅         |
| Env var leak  | ⚠️      | —      | ✅          | —          |
| /proc reading | ⚠️      | —      | —           | —          |
| Reverse shell | ✅      | —      | —           | —          |
| Network exfil | ✅      | —      | —           | —          |
| setuid        | ✅      | —      | —           | —          |

The gaps: `/proc` reading and environment variable leakage. `seccomp` can't block `getenv()` — that's a memory read, not a syscall. And `/proc` filtering with BPF argument inspection is fragile.

**90% coverage is achievable. The remaining 10% needs creativity.**

## Clever Workarounds

### 1. `LD_PRELOAD` Interception

No kernel access needed. Compile a shim that wraps `open()`:

```c
// Intercept file opens at the libc level
int open(const char *path, int flags, ...) {
    if (strstr(path, "/proc") || strstr(path, "/var/task"))
        return -EACCES;
    return real_open(path, flags, ...);
}
```

```bash
LD_PRELOAD=/lib/shimmy_sandbox.so python3 student_submission.py
```

Student code calls `open("/proc/self/environ")` → gets denied. No kernel changes. Works anywhere `LD_PRELOAD` isn't stripped.

Downside: a determined student who knows about this can work around it (call `syscall()` directly). It's defense-in-depth, not a hard boundary.

### 2. Environment Sanitization

The simplest fix for env var leaks:

```python
clean_env = {
    "PATH": "/usr/bin:/usr/local/bin",
    "HOME": "/tmp/student",
    "LANG": "en_US.UTF-8",
    # Everything else stripped — no AWS_*, no secrets
}
subprocess.run(["python3", "submission.py"], env=clean_env)
```

Zero overhead. Should be the baseline for any approach.

### 3. WebAssembly (The Nuclear Option)

Run student code inside a WASM runtime. Pyodide compiles CPython to WASM; Wasmer/Wasmtime provide the host.

```
student code → Pyodide → WASM linear memory → Wasmtime
                                              ↑
                                    No syscalls. No filesystem.
                                    Everything goes through host imports.
```

This solves everything — `/proc`, env vars, network, all of it. The WASM instance has no concept of the host filesystem.

The cost: Pyodide adds ~30MB and seconds of startup. For a platform that values fast feedback, that's real. But it's the only option that closes all the gaps.

## The Recommended Stack

For now: **fork + seccomp + rlimit + env sanitization**.

```
Lambda invocation
  └── fork() new process
        ├── Apply seccomp-bpf filter (deny dangerous syscalls)
        ├── Apply rlimit (CPU, memory, open files)
        ├── Clean env (strip AWS_*, keep only PATH/HOME/LANG)
        ├── Clear /tmp
        └── exec student code
```

This covers ~90% of the threat surface with low complexity, no root, and reasonable performance overhead.

WASM goes on the roadmap as the long-term path for languages where the toolchain supports it. Python is the priority — Pyodide is production-ready enough.

## What's Next

- Read the papers: [Firecracker (NSDI'20)](https://www.usenix.org/system/files/nsdi20-paper-agache.pdf), syscall interposition survey
- Understand shimmy's current architecture before touching anything
- Verify what seccomp actually allows inside Lambda (empirical testing beats assumptions)
- Supervisor meeting in two weeks

The interesting constraint here — userspace-only, no OS changes — forces creative solutions. That's what makes it a research project rather than a configuration problem.
