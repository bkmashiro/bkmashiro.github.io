---
title: "RedScript 2.0–2.2: From Toy to Proper Language"
date: 2026-03-16
description: "One afternoon-to-midnight session: enums, generics, Option<T>, LSP, coroutines, source maps, incremental compilation — and a bunch of bugs that only appear when you actually load the datapack into Minecraft."
readingTime: true
tag:
  - Minecraft
  - TypeScript
  - Compiler
  - RedScript
outline: [2, 3]
---

It's past midnight and I just pushed RedScript 2.2.1. The test suite went from 877 to 1136. The version number jumped from 2.0.0 to 2.2.1 in a single day. Most of the actual code was written by Claude. But I was the one who kept loading the datapack into a real Minecraft server and watching things explode in new and interesting ways.

Let me tell you what happened.

- GitHub: [bkmashiro/redscript](https://github.com/bkmashiro/redscript)
- npm: [redscript-mc](https://www.npmjs.com/package/redscript-mc)
- Docs: [redscript-docs.pages.dev](https://redscript-docs.pages.dev)
- Online IDE: [redscript-ide.pages.dev](https://redscript-ide.pages.dev)

---

## Background: What Is RedScript?

RedScript is a TypeScript-like language that compiles to Minecraft datapacks. Instead of running in a JS engine, it compiles to `.mcfunction` files — using scoreboards as variables, NBT storage as "memory", macros for dynamic dispatch, and the Minecraft command execution model as its runtime.

```redscript
// This is valid RedScript
function fibonacci(n: int): int {
  if (n <= 1) return n
  return fibonacci(n - 1) + fibonacci(n - 2)
}
```

```mcfunction
# This is what it compiles to (simplified)
scoreboard players operation $a0 rs = $p0 rs
# ... 40 more lines of scoreboard arithmetic
```

It's absurd. It's delightful. It works. The 1.x series proved the concept; 2.x is where it becomes something you'd actually want to use.

---

## Phase 1–6: The Language Features Dropped Today

I won't pretend this was a leisurely stroll through compiler theory. It was more like: design feature, implement, test, discover it breaks something, fix, repeat. Here's what landed:

### Type System Upgrades

**Enums** — proper discriminated unions, not just integer aliases. The compiler knows the variants at compile time and emits optimized scoreboard checks.

**Generics** — `Stack<T>`, `List<T>`, monomorphized at compile time. The compiler generates a separate instantiation per type. Yes, it's code bloat. No, I don't care yet.

**`Option<T>`** — `None` is represented as a sentinel scoreboard value. `unwrap()` panics (kills the function with `/kill @s`, basically). `map()` and `flatMap()` generate the branching mcfunction calls you'd expect.

```redscript
// Before: everything could silently be garbage
function getBlock(pos: BlockPos): int {
  return readNBT(pos)  // could be undefined if chunk unloaded 😬
}

// After: explicit about the possibility
function getBlock(pos: BlockPos): Option<int> {
  if (!isChunkLoaded(pos)) return None
  return Some(readNBT(pos))
}
```

**TypeChecker strict mode** — previously the type checker was... optimistic. Now it yells at you for implicit `any`, missing return types, and operations between incompatible numeric types.

### Infrastructure

**Incremental compilation** — file hashes tracked in a manifest. Unchanged files don't recompile. On a medium-sized project, this cut rebuild time from ~8s to ~1s.

**Source maps** — error messages now point to the original `.mcrs` file and line number instead of the generated `.mcfunction`. This sounds boring but it's genuinely life-changing for debugging.

**LSP (Language Server Protocol)** — hover types, completion, go-to-definition. You can now write RedScript in VS Code with proper intellisense. This was the single biggest quality-of-life improvement.

### Minecraft-Native Features

**`@coroutine` decorator** — this one's clever. Minecraft runs at 20 ticks/second. If your function does too much work in one tick, the server stutters. `@coroutine` wraps a function so it yields every N ticks, spreading work over multiple game cycles.

```redscript
@coroutine(tickBudget: 5)
function processAllEntities(entities: Entity[]): void {
  for (const entity of entities) {
    heavyProcessing(entity)  // yields to MC every 5 ticks automatically
  }
}
```

**`@schedule`** — `@schedule(20)` on a function makes it run every 20 ticks (once per second). Sugar over `schedule function ... 20t`.

**Module system** — `import` / `export`, with proper namespace isolation. Multiple `.mcrs` files can now share types and functions without polluting the global scoreboard namespace.

### Toolchain

**Multi-version targets** — `--target 1.20`, `--target 1.21`. Some MC commands changed between versions. The compiler now emits version-appropriate syntax.

**Stdlib include path** — `import { Timer } from "stdlib/timer"` just works. No more copying stdlib files into every project.

---

## The Bugs That Only Appear In Real Minecraft

Here's the thing about testing a Minecraft compiler: the simulator is a lie.

Not a malicious lie — it's a faithful implementation of the *spec*. But the actual Minecraft server has quirks that no spec documents. And you only discover them when you `git clone` the datapack, drop it in `world/datapacks/`, run `/reload`, and watch the error log.

### Bug 1: The Double Space

```mcfunction
execute  run function mypack:myfunction
```

Spot it? There are **two spaces** between `execute` and `run`. My IR-to-mcfunction emitter had a template string that looked like this:

```typescript
// compiler/codegen/emit.ts
const cmd = `execute ${condition} run function ${fnName}`
```

When `condition` was an empty string (unconditional execute), you got `execute  run function` — double space. Every unit test in the simulator passed because the simulator's command parser trims whitespace. The actual Minecraft parser does not. It returns `Unknown command` and silently does nothing.

Found it by staring at the generated `.mcfunction` file at 11pm wondering why my conditional blocks weren't executing.

### Bug 2: BlockPos Coordinates Becoming `undefined`

```redscript
const pos: BlockPos = { x: 10, y: 64, z: -30 }
teleportTo(pos)
```

In the simulator: works. In Minecraft: teleports to `10 undefined -30`. Crash.

The culprit: BlockPos was stored as three separate scoreboard values (`pos.x`, `pos.y`, `pos.z`). The codegen for struct field access had a bug where negative literal values weren't being emitted — they'd emit the field name without the value assignment, leaving the scoreboard slot at its previous (uninitialized) value of `0`. And somehow, `0` wasn't causing the same obvious crash as `undefined`... until it did.

Actually the `undefined` text came from a debug format string that checked `score ?? 'undefined'` in a diagnostic helper. The fix was a one-liner in the literal emission path. The *finding* it took two hours.

### Bug 3: Coroutine + Macro Functions

```redscript
@coroutine(tickBudget: 3)
function updateAll(list: Entity[]): void {
  for (const e of list) {
    process(e)  // process() uses @macro internally
  }
}
```

The `@coroutine` wrapper saves and restores execution state across ticks by writing to NBT storage. The `@macro` decorator makes a function use MC's `$()` macro substitution for dynamic dispatch. When you combine them, the macro context gets serialized into the coroutine state NBT... except the way Minecraft handles macro compound data means the re-invocation doesn't reconstruct it correctly.

The fix: coroutines now eagerly evaluate all macro arguments before suspending, then pass concrete values when resuming. You lose some performance, but you get correct behavior. Correct > fast.

### Bug 4: Array Index Access Compiling to `const 0`

```redscript
function first<T>(arr: T[]): T {
  return arr[0]
}
```

The compiled output for `arr[0]`:

```mcfunction
# Expected: read arr[0] into result register
# Actual:
scoreboard players set $result rs 0
```

The generic monomorphization pass was substituting `T` with the concrete type but forgetting to update the array access expression nodes. The index expression `0` was being emitted correctly, but the *load* instruction was being lost — only the constant `0` remained as a no-op assignment. Every call to `first()` returned 0, regardless of what was in the array.

This one passed all 877 unit tests because none of them tested a generic function with an array-index return in strict mode. Added 47 new tests. Fixed the codegen. Now at 1136.

---

## Timer Stdlib: The Deep One

The most interesting technical work today was redesigning the `Timer` stdlib.

### The Problem

In JavaScript, you'd write:

```typescript
const t = new Timer(1000, () => {
  console.log("tick!")
})
t.start()
```

In Minecraft, there is no heap. There is no `new`. There are scoreboards (named integer slots) and NBT storage (JSON-ish blobs). "Objects" are just namespacing conventions over these flat namespaces.

So how do you implement `Timer`?

### Attempt 1: Runtime Global Counter

Assign each timer a unique ID at runtime using a global counter scoreboard:

```mcfunction
# timer_create.mcfunction
scoreboard players add $timer_id_counter rs 1
scoreboard players operation $new_timer rs = $timer_id_counter rs
```

Problem: the scheduled function `timer_N_tick.mcfunction` doesn't exist at runtime. It needs to exist at compile time. You can't generate new function files while Minecraft is running.

### Attempt 2: Compile-Time Static ID Allocation

The compiler tracks how many timers exist in each module and assigns IDs statically:

```redscript
// Module-level: ID assigned at compile time → timer_0, timer_1
const alertTimer = new Timer(20, () => {
  broadcastMessage("One second passed!")
})

const cleanupTimer = new Timer(100, () => {
  cleanupExpiredEntities()
})
```

The compiler generates `timer_0_tick.mcfunction` and `timer_1_tick.mcfunction` at compile time. The IDs are stable across compilations (based on declaration order in the module).

### Lambda Codegen

The lambda `() => { broadcastMessage("One second passed!") }` compiles to:

```mcfunction
# timer_0_tick.mcfunction (auto-generated)
function mypack:broadcast_message
# (with argument setup for "One second passed!")
```

And `alertTimer.start()` becomes:

```mcfunction
schedule function mypack:timer_0_tick 20t
```

`alertTimer.stop()` cancels it:

```mcfunction
schedule clear mypack:timer_0_tick
```

### The Hard Constraint

The fundamental constraint: **Timers must be module-level variables.** You cannot create a timer inside a loop:

```redscript
// COMPILE ERROR: Timer cannot be created in a loop body
for (const entity of entities) {
  const t = new Timer(5, () => cleanupEntity(entity))  // ❌
  t.start()
}
```

Because the compiler would need to generate infinitely many `timer_N_tick.mcfunction` files — one per `entity`, which is a runtime quantity. The compiler catches this at compile time and tells you to use `@coroutine` or `@schedule` instead.

It's a real constraint. But it's honest about the platform. Minecraft datapacks aren't a JavaScript runtime; pretending they are leads to confusion. Better to fail loudly at compile time than silently at runtime.

---

## The Numbers

| Metric | Before | After |
|--------|--------|-------|
| Version | 2.0.0 | 2.2.1 |
| Test count | 877 | 1136 |
| Language features | enums, basic generics | + Option\<T\>, strict TypeChecker, coroutines, LSP, module system |
| Stdlib | math, bigint | + timer, scheduler, collections |

From early afternoon to past midnight. 259 new tests. 3 major bugs found exclusively in real Minecraft. One Timer redesign.

Most of the code: written by Claude, reviewed and debugged by me. I'm increasingly convinced the right mental model is "Claude is my pair programmer who types faster than me and never gets tired, but needs someone to actually run the code and tell it what broke." The simulator gap — bugs that only appear in real Minecraft — is still entirely a human problem. You need to actually play the game.

Which, honestly, is fine. Playing Minecraft to debug your compiler is a pretty good job.

---

```bash
npm install -g redscript-mc@2.2.1
```

Or try the [Online IDE](https://redscript-ide.pages.dev) — no install needed.
