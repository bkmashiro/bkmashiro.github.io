---
date: 2026-04-15
description: "A synthesis of 10 systems papers on serverless sandboxing: syscall interposition, MicroVMs, lightweight contexts, and the emerging no-syscall frontier."
title: "The Serverless Sandbox Landscape: From ptrace to Dandelion"
readingTime: true
tag:
  - Systems
  - Serverless
  - Security
  - Research
outline: [2, 3]
---

# The Serverless Sandbox Landscape: From ptrace to Dandelion

I spent the last few months reading ten systems papers that, taken together, map the entire design space for serverless sandboxing. This post is not a paper-by-paper summary. It is an attempt to identify the fault lines -- the tensions, convergence points, and trade-offs that define where the field is heading. I am writing this as someone actively building a serverless sandbox (Shimmy), so the lens is practical: what would you actually build today?

## The Fundamental Tension

Every sandbox negotiates the same deal: isolation strength versus execution overhead. The papers I read span the full spectrum, and the costs are quantified precisely enough to draw a clear picture.

At one extreme, **ptrace** gives you total control -- intercept every syscall, inspect every argument, run arbitrary logic -- at 31,201 ns per hook. At the other extreme, Dandelion's CHERI backend achieves cold starts under 90 microseconds by eliminating syscalls entirely. Between these poles, everything is a trade-off.

The landscape breaks down into roughly four strategies:

1. **Interpose on the kernel boundary** (ptrace, seccomp, SUD, binary rewriting)
2. **Specialize the VMM** (Firecracker)
3. **Replace the kernel boundary with software isolation** (Faasm/WebAssembly, Enclosure/MPK)
4. **Eliminate the kernel boundary** (Dandelion, SigmaOS)

What surprised me is how clearly these form an evolutionary sequence. Each generation solves the previous one's bottleneck, but introduces a new constraint. The field is converging, and the convergence point is not where most people expect.

## The Syscall Interposition Trilogy: zpoline, lazypoline, K23

The zpoline-to-K23 lineage is a masterclass in iterative systems design. Each paper solves exactly the flaw its predecessor left open.

**zpoline** (ATC 2023) discovered a beautiful trick: on x86-64, `syscall` is 2 bytes and `call rax` is 2 bytes. Since `rax` holds the syscall number (a small integer), rewriting `syscall` to `call rax` jumps execution to a nop sled at virtual address 0, which slides into a trampoline. Cost: 41 ns per hook -- 761x faster than ptrace. The insight that the calling convention already constrains `rax` to a small range is the kind of observation that seems obvious in retrospect but required genuine creativity to find.

The flaw: zpoline rewrites at load time. JIT-compiled code, dynamically loaded libraries, anything generated after setup -- invisible. Not truly exhaustive.

**lazypoline** (DSN 2024) fixed this with a hybrid design. It uses Linux's Syscall User Dispatch (SUD) as a slow path: when a never-before-seen `syscall` instruction executes, the kernel delivers SIGSYS. The signal handler rewrites it zpoline-style, and all subsequent executions take the fast path. The lazy rewriting pattern -- use a reliable-but-slow mechanism to discover what needs optimization, then install a fast mechanism -- is broadly applicable beyond syscall interposition. Performance: 94-95% baseline throughput on web server benchmarks, with guaranteed exhaustiveness.

But lazypoline also surfaced a deeper problem. The paper's ABI analysis (using Intel Pin) revealed that 40-100% of common coreutils expect extended CPU state (SSE/AVX/x87) to be preserved across syscalls. Every prior binary rewriter silently corrupted this state. This finding alone -- that all previous rewriters had latent bugs -- justified the paper.

**K23** (Middleware 2025) then systematically catalogued five classes of pitfalls in both zpoline and lazypoline: LD_PRELOAD bypass (clear environment variables before `execve` and your interposer vanishes), SUD disable via `prctl`, static disassembly misidentification, NULL execution without validation, and non-atomic runtime rewriting. K23's response is a two-phase design: offline profiling to identify hot syscall sites, online selective rewriting of only those sites, with ptrace covering the boot sequence and SUD as fallback. Result: 98.62% baseline throughput -- essentially matching zpoline's 98.93% -- while being the only system to handle all five pitfall classes.

The exhaustiveness-efficiency-expressiveness trilemma that lazypoline named turns out to be solvable, but the solution requires combining three separate mechanisms (ptrace for boot, binary rewriting for hot paths, SUD for stragglers). The era of single-mechanism interposition is over.

### What Syscall Interposition Cannot Solve

Even K23 pays an unavoidable tax: simply enabling SUD adds 1.23x overhead on all syscalls, even unintercepted ones, because the kernel checks a selector byte on every syscall entry. This is a kernel-level cost that no userspace trick can eliminate. And the entire approach remains x86-64 only -- zpoline's nop-sled trick depends on variable-length instructions and unaligned jumps, neither of which exist on ARM or RISC-V.

More fundamentally, all these systems operate in the same address space as the code they are sandboxing. Without an orthogonal isolation mechanism (MPK, hardware virtualization, CHERI), a sufficiently motivated attacker can overwrite the trampoline, the selector byte, or the interposer itself. The papers are honest about this -- K23 explicitly defers to "orthogonal intra-process isolation mechanisms" -- but it means syscall interposition alone is not a sandbox. It is one layer in a defense stack.

## The MicroVM Bet: Firecracker

Firecracker's (NSDI 2020) core insight is deceptively simple: **specialize the VMM, not the OS**. Instead of building a new OS or a new isolation mechanism, strip QEMU down to its minimum: 50K lines of Rust versus QEMU's 1.4 million lines of C. Keep KVM. Keep the Linux guest kernel. Remove BIOS, PCI, VM migration, Windows support, and 40+ emulated devices. What remains is a VMM with 3MB per-VM overhead (versus QEMU's 131MB), ~125ms boot, and the full isolation guarantee of hardware virtualization.

The numbers that matter for serverless economics: at 128MB function memory, QEMU wastes 100% in VMM overhead; Firecracker wastes 2.3%. This is the difference between running 8,000 and running 100,000+ functions on a single machine.

Firecracker's Jailer is instructive as a defense-in-depth pattern: even after placing user code inside a hardware-isolated VM, the VMM itself runs in a chroot with only 24 allowed syscalls and 30 ioctls. If the VMM is compromised, the attacker lands in a sandbox. This "sandbox the sandbox" approach is worth stealing for any design.

What Firecracker trades away is cold start. Even with snapshot restore, the guest OS represents an irreducible cost. Dandelion's measurements show that 8ms of Firecracker's snapshot restore goes to loading the guest OS snapshot and rebuilding host-guest networking -- operations whose sole purpose is to provide a POSIX-like interface to user code. This observation drives the next generation.

## The No-OS Frontier: Faasm, SigmaOS, Dandelion

Three papers push toward eliminating the OS boundary entirely, each from a different angle.

**Faasm** (ATC 2020) uses WebAssembly's linear memory model as the isolation primitive. Every function gets a contiguous byte array accessed through zero-based offsets; the WebAssembly runtime enforces bounds at compile time and traps on violations. Resource isolation comes from Linux cgroups. The result: 0.5ms cold start via Proto-Faaslet snapshots (5,600x faster than Docker), 90KB memory per instance (15x less than containers), and the ability to share state between co-located functions through shared memory regions without breaking isolation. Faasm proved that containers are not the only viable serverless isolation mechanism.

The WebAssembly tax is real, though: 40-240% compute overhead on some benchmarks due to 32-bit address space limits and missing compiler optimizations. For data-intensive parallel workloads (where Faasm shines through its two-tier shared-memory state architecture), the distributed speedup more than compensates. For compute-bound single functions, it hurts.

**SigmaOS** (SOSP 2024) attacks from the cloud-native angle. Its key observation: modern cloud applications interact with cloud infrastructure (S3, APIs, databases), not local OS resources. If you restrict functions to a cloud-centric API, you can eliminate the two most expensive container operations: overlay filesystem creation (~5ms) and network namespace creation (~100ms). SigmaOS's sigma-containers allow only 67 syscalls (versus Docker's 352) and block all network syscalls entirely -- connections go through a trusted proxy that hands off file descriptors after authentication. Cold start: 7.7ms. The trade-off: no backward compatibility with existing Linux applications.

**Dandelion** (SOSP 2025) takes the most radical position. It decomposes applications into pure compute functions (no syscalls, no networking, no threads) and communication functions (trusted platform code handling HTTP). Compute functions run in sandboxes that do not need a guest OS because they do not need syscall support. I/O happens outside the sandbox entirely. The results are striking: CHERI backend cold start under 90 microseconds, KVM backend 889 microseconds (with no guest kernel), and -- the number that should get every cloud economist's attention -- **96% reduction in committed memory** compared to Knative autoscaling with Firecracker, because per-request sandbox creation eliminates the need to pre-warm idle instances.

Dandelion's dlibc provides standard C interfaces (malloc, file I/O) through a userspace virtual filesystem where input/output sets appear as files. No syscall is ever issued. The TCB shrinks to ~2K lines of Rust that directly touch isolation and user code, versus Firecracker's ~68K lines.

The question is whether these approaches converge. I think they do. Faasm eliminated the container. SigmaOS eliminated the overlay filesystem and network namespace. Dandelion eliminated the guest OS and the syscall interface. The trajectory is clear: **the kernel boundary is being pushed out of the critical path for serverless execution**. What replaces it depends on your trust model.

## Seccomp-eBPF: The Stateful Filter

The seccomp-eBPF paper (arXiv 2023) addresses a different problem: making the kernel's own filtering mechanism powerful enough to be useful. Classic seccomp-BPF is stateless, cannot dereference pointers, has no synchronization primitives, and is limited to 4096 instructions. This forces real deployments to be overly permissive -- containers must allow `exec` for their entire lifetime because cBPF cannot express "allow once during init, then deny."

eBPF changes this. The paper introduces stateful filters (count syscall invocations, implement temporal specialization), safe userspace memory access (copy-to-kernel-buffer to prevent TOCTTOU), and syscall serialization (atomic variables that force racing syscalls to serialize). The temporal specialization results are compelling: restricting init-phase-only syscalls after startup reduces attack surface by 33-55% across six server applications.

The performance story is clean: eBPF filters match optimized cBPF in overhead (~60 cycles), while the Seccomp Notifier (userspace agent) is 45x slower. This makes eBPF the clear path for any filter that needs to be smarter than a static allowlist.

The catch: seccomp-eBPF has not been merged into mainline Linux. The maintainer response at LPC was effectively "Seccomp does not need eBPF." This is a political problem, not a technical one, and it matters for anyone planning to depend on it.

## In-Process Isolation: Lightweight Contexts and Enclosure

Two papers explore isolation within a single process, avoiding the kernel boundary entirely.

**Lightweight Contexts** (OSDI 2016) added a new OS abstraction to FreeBSD: lwCs share threads but have independent virtual memory mappings, file descriptor tables, and credentials. Switching between lwCs costs 2 microseconds -- half of a process context switch -- because it is just a CR3 register swap with PCID-tagged TLB entries. The nginx evaluation showed negligible throughput impact. SSL key isolation (putting the private key in a separate lwC) cost 0.7% overhead across 10,000 handshakes. The snapshot/rollback pattern -- take a lwC snapshot before handling a request, discard all state afterward -- is elegant for serverless: it guarantees no information leakage between invocations without container restart.

The persistent lesson: **isolation does not have to be expensive**. The fact that lwC was never ported to Linux (the paper is from 2016) is a social failure, not a technical one.

**Enclosure** (ASPLOS 2021) takes the language-integration approach. It extends Go and Python with a `with` construct that binds a closure to a memory view (which packages are accessible) and a syscall filter. The LitterBox backend enforces these policies using either Intel VT-x (924ns switch) or Intel MPK (86ns switch). The MPK backend achieves 1.02x overhead on HTTP workloads.

Enclosure's insight is that **packages are the natural unit of in-process isolation**. The default policy -- only natural dependencies visible, all syscalls blocked -- matches how developers actually think about trust: "I trust my code; I do not trust this pip package." The paper's discussion of CHERI as a future LitterBox backend is prescient: capability hardware would eliminate MPK's 16-key limit and enable object-granularity isolation without page alignment constraints.

## Where Things Are Heading

Reading these ten papers in sequence, three trends emerge clearly.

**First, the kernel boundary is losing its monopoly on isolation.** Firecracker moved the trust boundary to the hypervisor. Faasm moved it to the WebAssembly runtime. Dandelion moved it to a 2K-line Rust output parser. Enclosure moved it to compiler-enforced package boundaries with hardware-backed memory views. Each system demonstrates that "process" is not the only -- or even the best -- unit of isolation for serverless workloads.

**Second, hardware is catching up to software ambitions.** Intel MPK enables 86ns domain switches. ARM Morello (CHERI) enables sub-90-microsecond sandbox creation in a single address space. The CHERI capability model -- where every pointer carries its own bounds and permissions, enforced by the hardware on every memory access -- represents the endgame for in-process isolation. When Enclosure discusses CHERI as a future backend, and Dandelion implements a CHERI isolation backend that is faster than all alternatives, they are pointing at the same future: **hardware-enforced capabilities replace the kernel as the primary isolation primitive**.

**Third, the "no-syscall" design point is viable and may be optimal.** Dandelion proved that for a meaningful class of workloads (data processing, ML inference, query execution, agentic AI workflows), eliminating syscalls entirely -- not filtering them, not interposing on them, eliminating them -- yields order-of-magnitude improvements in cold start, memory density, and tail latency stability. The 96% memory reduction and 2-3 orders of magnitude variance reduction are not incremental gains. They represent a different operating regime.

## What I Would Build Today

If I were starting a new serverless platform from scratch -- and I am, with Shimmy -- here is what the paper landscape tells me to do.

**Use a layered architecture with pluggable isolation backends.** Dandelion got this right: the same scheduler and execution engine can target KVM, processes, CHERI, or WebAssembly depending on the trust model. Do not pick one isolation mechanism. Pick an abstraction that lets you swap them.

**For untrusted arbitrary code, Firecracker-style MicroVMs remain the gold standard.** Nothing else provides equivalent isolation for unmodified Linux binaries. But specialize aggressively -- strip the guest kernel, use snapshot restore, maintain a pre-warm pool sized by Little's Law (`L = lambda * W`).

**For constrained compute functions (no I/O, no threading), eliminate the OS.** Dandelion's compute/communication split is the right design. Pure compute functions do not need a guest kernel. They do not need syscalls. Run them in a memory context with a custom libc that provides standard interfaces through userspace virtual filesystems. The cold start and density gains are too large to ignore.

**For syscall filtering, plan for eBPF even if you ship cBPF today.** Temporal specialization -- allowing init-phase syscalls but blocking them during execution -- is a 33-55% attack surface reduction that is essentially free. Write your filters in a way that can migrate from cBPF to eBPF when the kernel support lands.

**For in-process isolation, bet on CHERI long-term.** MPK's 16-key limit is a real constraint. lwC never escaped FreeBSD. CHERI provides per-pointer bounds enforcement with no key limits, no page alignment requirements, and sub-100-microsecond sandbox creation. It is not production-ready on commodity hardware yet, but the Morello results are compelling enough to design your abstractions to accommodate it.

**Always sandbox the sandbox.** Firecracker's Jailer pattern -- chroot, namespace, 24-syscall allowlist around the VMM itself -- should be the default for any isolation runtime. If the runtime has a bug, the attacker should land in another sandbox, not on the host.

The field is converging on a world where the kernel boundary is one isolation option among several, hardware capabilities enforce memory safety at pointer granularity, and the "cold start problem" is solved by making sandboxes cheap enough to create per-request. We are not there yet. But reading these ten papers, the trajectory is unmistakable.

---

*This post synthesizes research from: zpoline (ATC 2023), lazypoline (DSN 2024), K23 (Middleware 2025), Firecracker (NSDI 2020), Faasm (ATC 2020), Enclosure (ASPLOS 2021), Lightweight Contexts (OSDI 2016), Seccomp-eBPF (arXiv 2023), SigmaOS (SOSP 2024), and Dandelion (SOSP 2025).*

*Research by Akashi. Part of the [Shimmy serverless sandbox project](https://github.com/bkmashiro/shimmy-sandbox-prototypes).*
