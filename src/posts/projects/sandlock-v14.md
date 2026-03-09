---
title: "Sandlock v1.4: From Single File to Full-Stack Sandbox"
date: 2026-03-09
readingTime: true
outline: [2, 3]
tag:
  - "Systems"
  - "Security"
  - "C"
  - "Linux"
description: "Sandlock started as a 822-line C file doing seccomp and rlimits. By v1.4.0 it's a modular sandbox with strict mode, language-level sandboxes, source scanning, and a full attack defense matrix."
---

I've been documenting the evolution of `sandbox_exec` into something more general. This post covers Sandlock v1.4.0 — the point where it became a proper multi-layer security system rather than a clever wrapper.

**Repo:** [github.com/bkmashiro/Sandlock](https://github.com/bkmashiro/Sandlock)

## The Refactor: 822 Lines → 8 Modules

The v1.3.0 single file hit 822 lines and was getting unwieldy. We split it:

```
src/
├── sandlock.h    (156 lines)  — shared types, config struct
├── main.c        (261 lines)  — CLI parsing, fork/exec orchestration
├── config.c       (80 lines)  — validation, conflict detection
├── strict.c      (350 lines)  — seccomp notify path-level control
├── seccomp.c      (76 lines)  — BPF filter generation
├── landlock.c    (102 lines)  — Landlock LSM filesystem rules
├── rlimits.c      (31 lines)  — resource limits
├── pipes.c        (94 lines)  — I/O pipe handling
└── isolation.c   (110 lines)  — /tmp isolation and cleanup
```

The longest file went from 822 lines to 261. `make single` still builds the monolith for simpler deployments.

## v1.3: Log Levels

Simple but necessary — before this, sandlock output was all-or-nothing.

```bash
./sandlock              # INFO (default)
./sandlock -v           # DEBUG: shows "executing python3"
./sandlock -vv          # TRACE: maximum verbosity
./sandlock -q           # WARN: errors and warnings only
./sandlock -qqq         # SILENT: child output only
```

In testing, `-v` is invaluable for seeing exactly what the strict mode interceptor is doing. In production, `-q` keeps Lambda logs clean.

## v1.4: Strict Mode

This is the interesting one. The existing seccomp filter works at the syscall level — "block `socket()`, allow `read()`." That doesn't help if the threat is reading `/etc/passwd` or `/proc/self/environ` via an allowed `openat()`.

Strict mode uses `seccomp notify` (kernel 5.0+, `SECCOMP_FILTER_FLAG_NEW_LISTENER`) to intercept specific syscalls in the parent process rather than blocking them outright:

```
Parent                          Child
  │                               │
  │         fork()                │
  │                               │
  │                     install seccomp filter
  │                     with NEW_LISTENER
  │◄──── send notify_fd ─────────┤
  ├──────── "ready" ────────────►│
  │                               │
  ├── notify handler thread       │  execvp()
  │                               │
  │◄── openat("/etc/passwd") ────┤
  │
  ├── is_path_allowed()?
  │   ├─ YES → SECCOMP_USER_NOTIF_FLAG_CONTINUE
  │   └─ NO  → EACCES
```

Usage:

```bash
# Allow only /tmp access
./sandlock --strict --allow /tmp -- python3 student.py

# Debug: see what's being blocked
./sandlock --strict --allow /tmp -v -- python3 student.py
# sandlock: DEBUG: BLOCKED: openat(/etc/passwd)
# sandlock: DEBUG: BLOCKED: openat(/proc/self/environ)
```

The filter always allows system paths needed for execution (`/bin`, `/lib`, `/lib64`, `/usr/bin`, `/etc/ld.so.*`, `/dev/null`, `/dev/urandom`). Everything else defaults to denied unless you `--allow` it.

## Config Conflict Detection

A new `config.c` module validates the configuration at startup before forking:

| Conflict                          | Action                                     |
| --------------------------------- | ------------------------------------------ |
| `--strict` without `--allow`      | Error — won't start                        |
| `--strict` + `--pipe-io`          | Warning — disables pipe-io (deadlock risk) |
| `--landlock` + `--strict`         | Warning — both work, but redundant         |
| `--isolate-tmp` + `--cleanup-tmp` | Warning — redundant                        |
| `--cpu` > `--timeout`             | Warning — timeout triggers first           |

No more silent failures from incompatible options.

## Language-Level Sandboxes

The C core handles the OS layer. v1.5.0 (released same day) added language-specific layers on top.

### Python (`lang/python/sandbox.py`)

Import hook + restricted builtins:

```python
# These modules are blocked at import time:
# socket, ssl, requests, subprocess, os, sys, ctypes, pickle, ...

# These builtins are removed:
# exec, eval, compile, input, open (replaced with restricted version)

# Allowed:
# math, json, re, collections, datetime, random, statistics, hashlib
```

The restricted `open()` allows `/tmp` reads/writes only.

**Known bypass vector:** `().__class__.__bases__[0].__subclasses__()` — the classic Python sandbox escape via introspection. Partial mitigation in place; the source scanner is the harder backstop.

### JavaScript (`lang/javascript/`)

Two variants:

- **`sandbox.js`** — strict VM isolation via Node's `vm` module, no process/eval/Function, module whitelist
- **`wrapper.js`** — npm packages available, runtime patching at the `require` level

### Source Code Scanner (`lang/scanner/scanner.py`)

Pre-execution static analysis for C/C++/Python/JavaScript/Rust/Go:

| Severity    | Pattern                    | Example                      |
| ----------- | -------------------------- | ---------------------------- |
| 🔴 Critical | Inline assembly            | `asm("syscall")`             |
| 🔴 Critical | Direct syscall instruction | `int 0x80`                   |
| 🔴 Critical | Custom entry point         | `_start()`                   |
| 🟠 High     | FFI/ctypes                 | `dlopen`, `cffi`, `ffi-napi` |
| 🟡 Medium   | Dangerous functions        | `fork`, `socket`, `eval`     |

This runs before compilation or execution — the only layer that can catch direct syscall attempts in inline assembly.

### LD_PRELOAD Hook (`lang/preload/sandbox_preload.c`)

For compiled binaries where you can't modify the source:

```bash
LD_PRELOAD=./sandbox_preload.so \
  SANDBOX_NO_NETWORK=1 \
  SANDBOX_NO_FORK=1 \
  SANDBOX_ALLOW_PATH=/tmp \
  ./program
```

Hooks `socket`, `connect`, `bind`, `fork`, `execve`, `execvp`, `open`, `fopen`. Also blocks `unsetenv`/`putenv` to prevent `LD_PRELOAD` removal.

**Known bypass:** static linking, inline `syscall()` asm. The scanner is the defense against these.

## The Full Defense Matrix

The real value of the modular design is how the layers compose. Here's how Full-Stack Sandlock covers the attack surface:

| Attack               | seccomp | Landlock/Strict | Language sandbox | Scanner | Result     |
| -------------------- | :-----: | :-------------: | :--------------: | :-----: | ---------- |
| Network exfiltration |   ✅    |        —        |        ✅        |    —    | 🔴 Blocked |
| Reverse shell        |   ✅    |        —        |        ✅        |    —    | 🔴 Blocked |
| Fork bomb            |   ✅    |        —        |        ✅        |    —    | 🔴 Blocked |
| Read /etc/passwd     |    —    |       ✅        |        ✅        |    —    | 🔴 Blocked |
| Write outside /tmp   |    —    |       ✅        |        ✅        |    —    | 🔴 Blocked |
| ptrace               |   ✅    |        —        |        —         |    —    | 🔴 Blocked |
| Inline asm syscall   |   ✅    |        —        |        —         |   ✅    | 🔴 Blocked |
| dlopen/FFI           |   ✅    |        —        |        ✅        |   ✅    | 🔴 Blocked |
| Direct syscall (asm) |   ✅    |        —        |        ⚠️        |   ✅    | 🟡 Hard    |
| /proc info leak      |    —    |       ⚠️        |        ⚠️        |    —    | 🟡 Partial |

The remaining gaps — `/proc` information leakage, kernel 0-days — require mount namespaces and OS-level updates respectively. Neither is solvable in pure userspace.

## Kernel Compatibility

| Feature        | Min Kernel | AWS Lambda (5.10) | Modern (6.x) |
| -------------- | :--------: | :---------------: | :----------: |
| seccomp-bpf    |    3.5     |        ✅         |      ✅      |
| seccomp notify |    5.0     |        ✅         |      ✅      |
| Landlock       |    5.13    |        ❌         |      ✅      |

Lambda runs kernel 5.10 via Firecracker — Landlock isn't available, and Firecracker applies its own seccomp filter that blocks installing additional ones. For Lambda, the defense stack is: rlimits + language sandbox + LD_PRELOAD + source scanner + env cleanup + VPC egress rules.

## Performance

| Configuration                         | Overhead |
| ------------------------------------- | -------- |
| Minimal (seccomp + rlimits)           | ~1.5ms   |
| Full (all options)                    | ~2.5ms   |
| Strict mode (per-intercepted syscall) | ~0.1ms   |
| Python sandbox overhead               | ~8ms     |

The 8ms Python sandbox overhead is the import hook scanning module names on every import. Worth it for the protection, but worth knowing.

## What v1.5.0 Looks Like

The total codebase is now ~4,700 lines across C, Python, and JavaScript:

```
src/*.c + *.h          ~1,500 lines
lang/python/           ~320 lines
lang/javascript/       ~670 lines
lang/scanner/          ~450 lines
lang/preload/          ~250 lines
tests/                 ~500 lines framework + 48 attack tests
```

CI triggers on changes to `sandlock.c`/`Makefile`. Bomb tests (fork bomb, memory bomb, CPU bomb) require manual opt-in — they pass through three layers of timeout (sandlock internal → shell `timeout 10` → GitHub `timeout-minutes: 10`) so they can't harm the runner, but they're still gated to avoid accidental triggers.
