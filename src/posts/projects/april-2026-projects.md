---
date: 2026-04-15
description: "Six projects built in April 2026: an environment diff tool, an AI filesystem, a pipeline debugger, a state machine DSL, a polyglot script runner, and a Python steganography tool."
title: "What I Built in April 2026"
readingTime: true
tag:
  - Projects
  - Python
  - Dev Tools
outline: [2, 3]
---

April has been one of those months where I couldn't stop building things. Six projects in about two weeks, all in Python, all scratching a different itch — but when I look back at them together, there's a clear theme: making the invisible visible. Whether it's the state of your environment, the data flowing through a pipe, or a secret message hiding in plain sight inside your source code, every one of these tools is about surfacing information that was always there but hard to see.

Here's what I built, why I built it, and what I learned along the way.

## Strata — Environment Archaeology

[GitHub](https://github.com/bkmashiro/strata) · 3 commits · Python · SQLite

We've all been there. Something breaks. "It worked yesterday." You spend the next thirty minutes manually checking environment variables, running processes, Docker containers, package versions — trying to figure out what changed under your feet while you weren't looking.

Strata automates that entire process. It takes point-in-time snapshots of your development environment — env vars, open network ports, running processes, config file checksums, disk usage, Docker state, installed package versions — and stores them in a local SQLite database. When something breaks, you run `strata diff baseline now` and get a color-coded report of exactly what changed.

```bash
strata diff morning afternoon

# envvars
#   + STRATA_DEMO_VAR: 'hello-world' (added)
#   ~ PATH: '/usr/bin' -> '/usr/local/bin:/usr/bin'
# network
#   + Port 3000 now listening (tcp)
#   - Port 8080 no longer listening
# packages
#   ~ node: v18.17.0 -> v20.11.0
```

The design decision I'm happiest with is the collector architecture. Each data source (env vars, processes, network, etc.) is a self-contained collector class that implements `collect()` and `is_available()`. This means Strata degrades gracefully — if Docker isn't installed, the Docker collector simply reports itself as unavailable and gets skipped. No crashes, no configuration. I started with 8 collectors and by the second commit had expanded to 13, adding package manager breakdowns, git repo state, crontabs, SSH keys, and cloud config. The architecture made that trivially easy.

The most recent addition is git integration — Strata now auto-captures the current commit hash alongside each snapshot, so you can `strata bisect packages python3` to see how a package version tracked across your commit history. The last commit alone was 934 insertions across 6 files, mostly the git integration and new collectors. It's the kind of feature that turns a useful debugging tool into something you leave running as a post-commit hook.

## BranchFS — A Filesystem for AI Agents

[GitHub](https://github.com/bkmashiro/branchfs) · Python · FUSE + fallback mode

This one came from watching AI agents struggle with exploration. When an agent tries approach A, fails, and wants to try approach B, what does it do? Manually undo its changes? Spin up a Docker container? Use git (which is designed for humans, not machines)?

BranchFS is a copy-on-write branching filesystem designed specifically for AI agents. Fork a branch in under a millisecond, make changes, evaluate the result, merge or discard. No staging area, no commit messages, no interactive rebase — just fast, deterministic operations an agent can call in a tight loop.

```python
with fs.branch_context(snap_id, name="try-something") as branch:
    (branch.workdir / "solution.py").write_text("def solve(): ...")
    result = evaluate(branch.workdir)
    if result.good:
        branch.merge()
    # Not merged? Changes automatically discarded.
```

The interesting technical challenge was making it work everywhere. On Linux with FUSE available, BranchFS mounts as a transparent filesystem — the agent reads and writes normally, and copy-on-write happens at the kernel level. But AI agents often run in unprivileged containers where FUSE isn't an option. So there's a fallback mode that provides the exact same API using temporary directories and `shutil`. Same interface, same semantics, no kernel module. The content-addressable blob store (SHA-256 named files) handles deduplication in both modes, keeping storage overhead minimal even when an agent forks dozens of branches.

The comparison numbers tell the story: fork time is roughly 1ms (metadata only) versus 100ms for a git checkout versus 1 second for a Docker container create. When your agent is exploring hundreds of approaches, that difference matters.

## Pipespy — A Debugger for Unix Pipelines

[GitHub](https://github.com/bkmashiro/pipespy) · Python · Zero dependencies

Unix pipelines are beautiful until they're not. You write `cat log | sort | grep ERROR | sort | uniq -c | sort -rn | head` and it works, but you have no idea which stage is the bottleneck, where data gets dropped, or that you're sorting three times when you could sort once.

Pipespy is a profiler, debugger, and static analyzer for shell pipelines. Give it a pipeline string and it runs each stage while capturing timing, line counts, byte counts, and sample data between stages. Then it renders a visual report showing data flow, identifies the bottleneck and the biggest filter, and — this is the part I'm most proud of — detects anti-patterns and suggests concrete, runnable rewrites.

```bash
pipespy "cat log | sort | grep ERROR | sort | grep FATAL | wc -l" --no-run

# Anti-patterns Detected:
#   [i] useless-cat (stage 1)
#       sort can read files directly.
#   [~] sort-before-grep (stage 2)
#       sort processes more data than necessary. Move grep first.
#   [i] grep-wc (stage 6)
#       Replace `grep FATAL | wc -l` with `grep -c FATAL`
```

The anti-pattern detector knows about 8 common mistakes (useless cat, sort-before-grep, consecutive grep chains, redundant sorts, echo-piped-to-command, grep-piped-to-wc, awk-used-as-cut, large-sorts-without-filtering) and the optimizer generates 5 types of concrete rewrites with estimated speedups. Things like adding `LC_ALL=C` for byte-wise comparison, using `sort --parallel` for large datasets, or simply reordering stages to filter before sorting.

The parser was the trickiest part. Pipeline strings aren't as simple as splitting on `|` — you have to handle quoted arguments, nested subshells, escaped pipes, and environment variable prefixes. Getting that right was about 30% of the work. The other design decision worth mentioning: the `--no-run` flag does pure static analysis without executing anything, which means you can lint a pipeline involving production files without actually touching them.

## Machina — A State Machine DSL

[GitHub](https://github.com/bkmashiro/machina) · 2 commits · Pure Python · Zero dependencies

State machines show up everywhere — protocols, UI flows, game logic, workflow engines — but defining them in general-purpose languages always feels clunky. You end up with a tangle of enums, switch statements, and transition tables that's hard to read and impossible to analyze statically.

Machina is a domain-specific language for state machines. You write `.machina` files with a clean syntax for states, transitions, guards, and actions, and the toolkit can simulate execution, generate Graphviz/Mermaid diagrams, and — the headline feature — statically analyze composed systems for concurrency bugs.

```
machine Turnstile {
    var fare = 0
    state locked {
        on coin -> unlocked { action: fare += 1 }
        on push -> locked
    }
    state unlocked {
        on push -> locked
        on coin -> unlocked { action: fare += 1 }
    }
    initial locked
}
```

The parallel composition is where things get genuinely interesting. You define multiple machines that share events, and Machina builds the Cartesian product of their state spaces, then runs reachability analysis (BFS) and Tarjan's SCC algorithm to find deadlocks, unreachable composite states, synchronization conflicts, and livelock risks. This is essentially a lightweight model checker — catching concurrency bugs at design time before any runtime code exists.

The implementation is a classic compiler pipeline: lexer, recursive-descent parser, AST, then branching into analyzer, composer, executor, or visualizer. I went with zero external dependencies (pure Python 3.11+) because the whole point of a DSL toolkit is that it should be trivially installable. The test suite covers 73 cases across the lexer, parser, analyzer, executor, composer, and visualizer. The `demo/` folder includes a dining philosophers example that demonstrates deadlock detection — always satisfying to watch the tool catch the bug automatically.

## Chimera — Polyglot Script Runner

[GitHub](https://github.com/bkmashiro/chimera) · Python · Supports Python, JS, Bash, SQL

This one started as frustration with glue scripts. You have a SQL query that feeds a Python transform that feeds a Bash deploy step. Today that means three separate files, fragile shell piping, or a Jupyter server you don't want to maintain. Chimera lets you put everything in a single `.chimera` file with language-delimited sections.

```
--- python
users = [{"name": "Alice", "score": 95}, {"name": "Bob", "score": 82}]

--- javascript
topScorers = users.filter(u => u.score >= 90);
console.log("Top:", topScorers.map(u => u.name).join(", "));

--- sql @memory
SELECT name, score FROM users WHERE score > 90

--- python
for row in result:
    print(f"{row['name']}: {row['score']}")
```

The magic is in the data bridging. Variables defined in one section automatically flow into the next as native types. A Python list becomes a JavaScript array. A list of dicts becomes a SQLite table. Bash gets uppercased environment variables and a `chimera_export` helper to send data back. Each language executor wraps the user's code in a harness that injects context before and captures new variables after — for Python, that means `globals().update(context)` before execution and inspecting `dir()` afterward.

The architecture has 95 tests covering the parser, context system, individual executors, runner, and full integration. I was particularly careful with error handling — when a JavaScript section fails, the error message includes the section number and original line numbers, not the wrapper's line numbers. Small thing, but it makes debugging polyglot scripts actually tractable.

## Murmur — Python Source Steganography

[GitHub](https://github.com/bkmashiro/murmur) · Python · Zero dependencies

This is the weird one. Murmur hides secret messages inside Python source code by exploiting places where Python's syntax offers equivalent choices. Single quotes or double quotes? `x += 1` or `x = x + 1`? `return x` or `return (x)`? `x is None` or `x == None`? Each choice point encodes one bit. The modified file is syntactically valid, functionally identical, and carries a hidden payload.

```bash
murmur analyze mycode.py
# Total capacity: 292 bits (31 usable bytes)
#   string_quote: 153 sites
#   return_paren: 28 sites
#   trailing_semicolon: 93 sites

murmur encode mycode.py "secret message" -o encoded.py
python encoded.py  # identical output to original
murmur decode encoded.py  # "secret message"
```

The six encoding channels (string quotes, augmented assignments, return parenthesization, comparison order, None-check style, and trailing semicolons) each scan the source for available sites and can flip them independently. A key-based Fisher-Yates shuffle determines which sites carry which bits, so without the key you'd need to brute-force the site ordering.

The most interesting engineering problem was cross-channel interference. Changing `x += 1` to `x = x + 1` shifts column positions of everything after it on that line, which can invalidate sites from other channels on the same line. The solution is an iterative encoder: encode all bits, re-scan, check for mismatches, re-apply until convergence. In practice it takes 1-2 passes. An 8-bit checksum (truncated SHA-256) catches wrong keys or corrupted carriers.

Use cases are narrow but real: code watermarking for proving authorship, tracking which copy of a codebase leaked, and tamper detection (modifying the carrier destroys the message). It's not cryptographically robust steganography — a statistical analysis of style choices could detect it — but it's a genuinely fun application of the principle that style is information.

## What Connects These

Looking at these six projects together, I see a common thread that goes beyond "developer tools." Every one of them is about **making hidden structure explicit**.

Strata makes the invisible drift of your development environment visible. BranchFS makes the branching exploration that AI agents do internally into a concrete, inspectable filesystem operation. Pipespy reveals the data flow and performance characteristics that are normally opaque inside a pipeline. Machina takes state machine logic that's usually implicit in code and gives it a first-class, analyzable representation. Chimera makes the data handoffs between languages — normally buried in serialization glue — automatic and transparent. And Murmur goes in the opposite direction, deliberately hiding structure where none appears to exist.

They're also all pure Python, all zero-or-minimal dependencies, and all designed to be picked up in five minutes. I've been on a kick lately of building tools that are a single `pip install` away from being useful. No Docker required, no server to run, no config file to write. Just a CLI that does one thing well.

April isn't over yet, but these six feel like a complete set. Each one taught me something — collector architectures, FUSE filesystem internals, pipeline parsing edge cases, product-state-space analysis, cross-process variable serialization, and the surprising depth of Python's syntactic ambiguity. Not a bad month.
