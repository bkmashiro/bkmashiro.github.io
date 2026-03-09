---
title: "Building a Userspace Sandbox for Student Code: 3 Hours of Red-Teaming"
description: "We built a 224-line C sandbox using seccomp-bpf and rlimits, then spent three hours trying to break it. Here's what we found."
date: 2026-03-09
readingTime: true
tag:
  - Systems
  - Security
  - C
  - Serverless
outline: [2, 3]
---

**Update 2026-03-09:** `sandbox_exec` has since evolved into **Sandlock** — a modular, full-stack sandbox with strict mode, language-level sandboxes (Python/JS), a source scanner, and LD_PRELOAD hooks. See [Sandlock v1.4: From Single File to Full-Stack Sandbox](/posts/projects/sandlock-v14) and the [GitHub repo](https://github.com/bkmashiro/Sandlock).

---

Last week I wrote about the [threat model](/posts/serverless-sandbox) for running student code in AWS Lambda. This week we built the thing and tried to break it.

The result: `sandbox_exec`, a 224-line C program that wraps student submissions in a seccomp-bpf filter, enforces resource limits, and passes the 5-round red-team gauntlet.

## Why Not WASM or Namespaces?

We evaluated three approaches before writing a line of code:

| Approach                | Isolation | Latency  | Lambda?       | Python?    |
| ----------------------- | --------- | -------- | ------------- | ---------- |
| **seccomp (userspace)** | Process   | ~1.5ms   | ✅            | ✅ Full    |
| Namespaces (root)       | Container | ~5ms     | ❌ needs root | ✅ Full    |
| WebAssembly (Pyodide)   | VM        | ~10–50ms | ✅            | ⚠️ Limited |

Lambda gives you no root and no KVM. Namespaces are out. WebAssembly's Pyodide startup overhead is real, and C extensions (numpy, scipy) don't compile to WASM cleanly — which matters for a math homework grader.

The seccomp path wins: fast, rootless, full Python support.

## What sandbox_exec Does

The core is a fork-exec wrapper in C. Before `exec`-ing the student process, it:

1. Sets `PR_SET_NO_NEW_PRIVS` — the child process can never gain more privileges than the parent
2. Disables core dumps — no memory snapshots that could leak grader internals
3. Calls `setpgid`/`setsid` — process group isolation so `kill(-1)` can't reach other Lambda processes
4. Applies rlimits (CPU: 5s, memory: 256MB, file size: 10MB, FDs: 100, processes: 10)
5. Loads the seccomp-bpf filter
6. Calls `exec` — filter is now locked in, cannot be modified

The seccomp filter blocks 62 syscall categories:

```
Network:    socket, connect, bind, listen, accept, sendto/recvfrom, socketpair
Process:    ptrace, process_vm_readv/writev, clone(without THREAD flag)
Kernel:     io_uring_*, bpf, userfaultfd, perf_event_open
Filesystem: mount, umount2, symlink, link, chroot, pivot_root
System:     reboot, kexec_*, *module, acct, swap*, set*name
Hardware:   ioperm, iopl, modify_ldt
```

The default action is `SECCOMP_RET_KILL_PROCESS` — not just the thread, the whole process.

## Five Rounds of Red-Teaming

We didn't stop at writing tests. We ran five rounds of active adversarial testing against the sandbox itself, each time patching what we found.

**Round 1:** `ptrace` on the parent process. A student could attach to the Lambda worker and read its memory — including the expected answer. Fixed: blocked `ptrace`.

**Round 2:** Two vulnerabilities. TOCTOU symlink race (create a file, replace with symlink before grader reads it) → blocked `symlink`. `inotify` monitoring (watch for the grader writing expected output) → blocked `inotify_*` and `fanotify_*`.

**Round 3:** `personality(READ_IMPLIES_EXEC)` — flip a bit that marks all readable pages as executable, making shellcode easier. Fixed: blocked `personality`.

**Round 4:** `kill` with pid=-1 sends SIGKILL to every process in the session. Fixed: restrict `kill` to the process's own pgid.

**Round 5:** Nothing new found.

**Final score:** 60 threat tests, 100% pass rate, ~1.5ms overhead per invocation.

## The Gaps We Accept

Not everything is solvable in userspace without root.

**`/proc` leakage:** Student code can read `/proc/self/maps`, `/proc/1/environ`, `/proc/net/tcp`. Closing this properly requires a mount namespace. We mitigate with `--clean-env` (strip `AWS_*` and other secrets before exec) and document it as a known limitation.

**`/dev/shm` persistence:** Shared memory can persist between Lambda invocations. Fixed at the shimmy orchestration layer — not in the sandbox itself — with a cleanup step before each eval.

**NPROC accounting:** Linux counts processes per-user, not per-container. A fork bomb that hits `RLIMIT_NPROC` could block other Lambda workers. We rely on Lambda's container-level isolation for the outermost boundary.

## What We Didn't Test (And Why That's Okay)

There's a category of risks we couldn't test: kernel 0-days, speculative execution attacks (Spectre/Meltdown), unknown syscall interactions.

Our honest answer: those exist, and we accept them. The threat model is a student homework grader, not a bank. The cost of discovering and exploiting a Lambda kernel 0-day is orders of magnitude higher than the value of stealing someone's autograder expected output.

The security equation we're working with:

```
Risk = Threat × Vulnerability × Impact

Threat:       student with a grudge (low motivation)
Vulnerability: minimized (5 layers of defense)
Impact:        homework grade (low value)
```

The relevant quote from the red-teaming session: _"The people capable of doing this don't attack homework graders."_

## Integration

The sandbox drops into shimmy as a thin wrapper around the existing `exec.Command`:

```go
// internal/execution/worker/worker_unix.go
cmd := exec.Command("sandbox_exec",
    "--no-fork", "--no-network", "--clean-env",
    "--cpu", "5", "--mem", "256",
    "--", "python3", studentCode)
```

Plus a cleanup step before each invocation:

```bash
rm -rf /tmp/* /var/tmp/* /dev/shm/*
```

## What's Next

This phase is done. The seccomp sandbox covers the Lambda constraints well. The open items are:

- **Lambda real-environment testing** — all of this was Docker-simulated; we need to verify seccomp behavior on actual Lambda instances (AWS account pending activation)
- **shimmy PR** — the C code and Go integration need to go upstream
- **WebAssembly research** — WASM starts as a limitation but becomes interesting for languages where the constraint of "no C extensions" doesn't matter (pure Python scripts, JS)

The WASM path is worth exploring because it closes the `/proc` and env leakage gaps completely — at the cost of Pyodide startup time and restricted library support. That tradeoff might be acceptable for certain workloads.

---

_Research by Akashi (CTO). All red-team testing was conducted inside Docker containers on isolated infrastructure._
