---
title: "AVM: Mounting AI Agent Memory as a Filesystem"
description: "We built a FUSE filesystem backed by SQLite so AI agents can read and write their memory with standard shell tools — and then spent a day debugging macFUSE's quirks."
date: 2026-03-06
readingTime: true
tag:
  - Python
  - AI
  - System Design
  - FUSE
outline: [2, 3]
---

AI agents forget everything between sessions. The standard fix is a `MEMORY.md` file the agent reads at startup — but that's a blunt instrument. Every session loads the entire file, token cost grows linearly with time, and there's no structure to query against.

We wanted something better: a virtual filesystem for agent memory. Write memories with `echo`, query them with `cat :search`, recall relevant context with `cat :recall`. Use the tools every developer already knows.

## AVM: Agent Virtual Memory

The project is called **AVM** — [github.com/aivmem/avm](https://github.com/aivmem/avm).

The core idea: agent memories live at paths like `/memory/private/akashi/trading/btc_lesson.md`. A SQLite database stores the actual content with metadata (importance score, tags, TTL). A Python API provides structured access:

```python
agent = vfs.agent_memory("akashi")

# Write
agent.remember("RSI > 70 on NVDA → average -12% in 5 days",
               importance=0.9, tags=["trading", "nvda"])

# Token-budget-controlled recall
context = agent.recall("NVDA risk", max_tokens=2000)
# Returns compact markdown: most relevant memories within budget

# Cross-agent sharing
agent.share("/memory/private/akashi/market_regime.md", "shared/trading")
```

The `recall()` method is the key piece. Instead of loading everything, it scores candidates by **importance × recency × semantic relevance**, selects as many as fit within `max_tokens`, and returns a compact summary — not the raw file content. The agent gets a controlled-size context block, not an ever-growing dump.

## Benchmarks

We ran benchmarks on Mac Mini with SQLite FTS5:

| Operation                                    | Latency         |
| -------------------------------------------- | --------------- |
| `remember()` write                           | ~0.6ms          |
| FTS5 search (116 nodes)                      | **0.14ms**      |
| FTS5 search (1000 nodes)                     | **0.16ms**      |
| `recall()` with token budget                 | **0.11–0.28ms** |
| Semantic search (sentence-transformers, hot) | ~5.6ms          |

FTS5 is fast and essentially O(1) at these scales. Semantic search is significantly slower on CPU — useful for fuzzy matching but not needed for most recall queries.

## The FUSE Layer

The Python API is clean, but it means writing code to interact with your memory. The real unlock is a FUSE filesystem: mount AVM at `/tmp/avm`, then use standard shell tools.

```bash
avm mount /tmp/avm --daemon

# Write a memory
echo "RSI > 70 → exit" > /tmp/avm/memory/private/akashi/rsi_rule.md

# Read it back
cat /tmp/avm/memory/private/akashi/rsi_rule.md

# Search (virtual node)
cat /tmp/avm/:search?RSI

# Token-budget recall
cat /tmp/avm/:recall?query=NVDA+risk&max_tokens=2000

# Metadata
cat /tmp/avm/:stats
```

The virtual nodes (`:search`, `:recall`, `:stats`, `:meta`, `:tags`) are the clever part — they're not real files but FUSE-readable endpoints. Reading `:recall?query=X` triggers the full scoring and synthesis pipeline and returns the result as file content.

## Debugging macFUSE

Getting FUSE working on macOS took most of today. The bug chain:

**Problem 1: FUSE wouldn't mount at all.**

```
FUSE error: 1
RuntimeError: 1
No FUSE in mount table
```

`fuse_main_real()` returned 1 with no useful error. Root cause: the macFUSE kernel extension needs explicit approval in _System Settings → Privacy & Security_. The extension was installed but not authorized. After approval and a reboot, FUSE mounted — but only partially.

**Problem 2: `ls` blocked indefinitely.**

```
[getattr] / → OK
[getattr] /.DS_Store → ENOENT (expected)
ls (blocked, never returns)
```

`getattr` was working but `readdir` was never called. The fix: macFUSE requires `opendir` and `releasedir` methods to be implemented, otherwise `readdir` is silently not invoked. Fusepy doesn't document this clearly. Adding two stub implementations unblocked everything:

```python
def opendir(self, path):
    return 0

def releasedir(self, path, fh):
    pass
```

**Problem 3: Mount status detection broken.**

After daemon mode was working, `avm status` showed "stale" even when mounted. The code used `mount` to check mount status, but on macOS, `mount` isn't in the default `$PATH` for subprocesses — it's at `/sbin/mount`. One-line fix.

**Problem 4: `fusepy` not in required dependencies.**

`fusepy>=3.0` was listed as an optional dependency in `pyproject.toml`. Installing via `pip install avm` would skip it, causing `ModuleNotFoundError: No module named 'fuse'`. Moved to required deps.

After all four fixes, the full test suite ran clean:

```
:meta ✓  :tags ✓  :stats ✓  :search ✓  :recall ✓
daemon mode ✓  persistence ✓  file read/write ✓
```

## What's Next

The async embedding queue design we discussed: `remember()` writes content immediately, a background thread generates embeddings, and `recall()` falls back to FTS if the embedding isn't ready yet. This keeps writes at <1ms while eventually enabling semantic search without blocking the caller.

Test coverage is at 49% today (up from 40%). The remaining gaps are `mcp_server.py` (0%), `providers/*` (~20%), and `permissions.py` (34%).

The goal is for agents to treat memory like a filesystem — because that's exactly what it is.
