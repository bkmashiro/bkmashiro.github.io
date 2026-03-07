---
title: "AVM: Rethinking Memory for AI Agents"
description: "AI agents forget everything between sessions. The obvious fix is to give them files to read. The real fix is to rethink what memory means for a machine that thinks in tokens."
date: 2026-03-05
readingTime: true
tag:
  - AI
  - System Design
  - Multi-Agent
outline: [2, 3]
---

AI agents forget everything. Every session starts from zero. The only continuity is what you explicitly hand them at the start — and the naive solution is to dump everything into a pile of markdown files and load them all.

It works, until it doesn't.

## The Real Problem Isn't Storage

The instinct when you hit memory limits is to think about storage: where do I put the data? But that's the wrong question. The actual constraint is **the context window** — agents don't read from disk, they read from tokens. Everything that enters memory has to fit inside a finite, expensive budget.

So the real question isn't "where do I store memories?" It's "which memories are worth loading right now?"

This reframing changes everything. You don't need a bigger disk. You need a retrieval system that's aware of token cost — one that can look at a query and return the most relevant context without blowing the budget.

## Why a Filesystem?

AVM organizes agent memory as a virtual filesystem. This might seem like an odd choice. Why not a database? A vector store? A graph?

Because the filesystem is the most universal mental model for structured information that we have. Every developer understands paths, directories, permissions, and file operations. More importantly: agents understand it too. The tools agents already use — read, write, list, search — map directly onto filesystem operations.

There's a deeper reason. Memory isn't a single thing. An agent has private notes it shouldn't share, shared knowledge that should flow between agents, and broadcast channels for urgent signals. A filesystem makes these distinctions **visible and navigable**. A flat database doesn't.

```
/memory/private/{agent}/    ← yours alone
/memory/shared/market/      ← everyone reads, specialists write
/memory/shared/events/      ← broadcast, anyone can write
```

The namespace is the policy.

## Memory Shouldn't Be Overwritten

When you update your opinion about something, you don't erase what you thought before. You add a new observation alongside the old one. The history matters — it's evidence that your thinking evolved.

AVM treats writes as append operations by default. Every new observation creates a new node. Old versions persist. When you recall something, the system surfaces the most relevant nodes from across all versions, synthesizing them within your token budget.

This is the right semantic for memory. Overwriting is appropriate for configuration; it's wrong for knowledge. If two agents independently observe the same market signal and both write their analysis, you want both analyses — not whichever one wrote last.

## The `/proc` Insight

Linux has this elegant trick: `/proc` looks like a filesystem, but it's not. When you `cat /proc/cpuinfo`, you're not reading a file — you're triggering a kernel function that formats live system state as text. The filesystem interface is just a universal API.

AVM does the same thing for memory metadata. Every node has virtual sub-files:

- `note.md:meta` — the node's importance score, timestamps, provenance
- `note.md:links` — which other nodes this one relates to
- `note.md:history` — how the content changed over time
- `:search?q=RSI` — a directory-level search, rendered as a file read

The key insight: **the filesystem interface is complete enough to express arbitrary operations**. You don't need a special client library. You don't need to learn a new API. Shell commands, scripts, agents — anything that reads files works immediately.

## Multi-Agent as a First-Class Concern

Most memory systems are designed for a single agent. You add multi-agent support as an afterthought — usually by adding a prefix to distinguish whose data is whose.

AVM treats multi-agent as a first-class design constraint. The permission model is declarative: each agent has explicit read/write access to specific namespaces. An agent can't accidentally leak its private context to another agent. Shared knowledge has to be explicitly placed in shared namespaces.

This matters because agents make mistakes. An agent that writes sensitive reasoning to a shared namespace exposes it to everyone. An agent that reads another agent's private notes might be poisoned by context it wasn't meant to see. The permission system isn't bureaucracy — it's the boundary between agents that lets each one trust its own context.

## What "Token Budget" Really Means

Token-aware retrieval sounds like an optimization. It's actually a design philosophy.

The goal was never to delete old memories — deletion destroys information. The goal was to control **what gets loaded into a given session**. `recall()` doesn't return files; it returns a synthesized summary, scored by relevance, recency, and importance, trimmed to fit within a specified token budget.

This is closer to how human memory works than a database query. You don't retrieve your entire memory of a topic — you retrieve the most salient parts, filtered by context. The system does that filtering so the agent doesn't have to.

---

The filesystem metaphor, the append-only writes, the virtual nodes, the declarative permissions — these aren't implementation choices. They're answers to the same underlying question: what does it mean for an agent to remember?

Not to store. Not to retrieve. To actually carry forward what matters, in a form that's useful right now.

[github.com/bkmashiro/avm](https://github.com/bkmashiro/avm)
