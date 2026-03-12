---
title: "RedScript v1.2: A Typed Language for Minecraft Datapacks"
date: 2026-03-12
tags: [compiler, minecraft, typescript, programming-language]
description: "RedScript is a typed scripting language that compiles to Minecraft datapacks. v1.2 brings OOP, events, f-strings, and more."
readingTime: true
tag:
  - Compiler
  - Minecraft
  - TypeScript
  - Programming Language
outline: [2, 3]
---

Minecraft datapacks are programmable, but not pleasant to program. Scoreboards act like registers, `execute` chains act like control flow, and `function` calls simulate jumps between basic blocks. It is powerful enough to build mini-games and server logic, but raw `.mcfunction` authoring is still closer to wiring a finite-state machine than writing software.

RedScript is an attempt to fix that. It is a typed language that compiles to Minecraft datapacks, with a compiler pipeline that looks much more like a normal programming language toolchain than a command macro expander.

- GitHub: [bkmashiro/redscript](https://github.com/bkmashiro/redscript)
- Docs: [redscript-docs.pages.dev](https://redscript-docs.pages.dev)
- Online IDE: [redscript-ide.pages.dev](https://redscript-ide.pages.dev)

One version note up front: the `v1.2.0` tag contains the big language additions around `impl`, `@on(Event)`, timers, `is` narrowing, namespace work, and tag constants. `f-strings` and the AST-level DCE pass landed immediately after the `v1.2.0` tag on `main` the same day, so this post covers the practical v1.2 line rather than only the exact tag boundary.

---

## Introduction

### What is RedScript?

RedScript is a typed scripting language for Minecraft Java Edition datapacks. Instead of writing low-level command files directly, you write structs, functions, loops, decorators, and typed entity logic, then compile that source into the datapack file tree Minecraft actually executes.

The project is written in TypeScript, ships as `redscript-mc` on npm, has a VSCode extension (`bkmashiro.redscript-vscode`), and includes an online IDE for trying the language without installing anything locally.

### Why build a compiler for Minecraft?

Because Minecraft already behaves like a weird virtual machine:

- scoreboards are integer storage
- entity selectors are dynamic query expressions
- `execute ... run` is a control-flow primitive
- datapack tags like `minecraft:tick` and `minecraft:load` are runtime entry points

The problem is ergonomics. Even small game systems explode into dozens of helper functions and piles of boilerplate. A compiler lets you recover normal language features and then lower them back into the datapack model mechanically.

---

## What's New in v1.2

### `impl` blocks and OOP methods

`impl` adds method syntax to structs. There is no hidden runtime object model; methods are syntax sugar over ordinary functions. Instance calls like `timer.tick()` and static calls like `Timer::new(20)` both lower cleanly into prefixed functions.

### Static event system with `@on`

RedScript now has a static event layer:

```rs
@on(PlayerDeath)
fn handle_death(player: Player) {
    say("player died");
}
```

The compiler validates the event name and expected parameters, then wires the handler into a tick-time dispatcher that scans for event tags such as `rs.just_died`.

### f-strings for runtime output

Rich runtime output is now much nicer to write:

```rs
tellraw(@a, f"Score: {score}");
actionbar(@s, f"Time left: {time}");
```

Instead of concatenating text early, RedScript compiles these expressions into `tellraw` / `title` JSON components, which means integers can stay as scoreboard-backed values at runtime.

### Type narrowing with `is`

Entity types are no longer just strings. Checks like `if (e is Player)` now inform the type checker and the lowering pipeline, so control flow can narrow entity types in a way that maps to selector predicates.

### Timer API and `setTimeout` / `setInterval`

The standard library gained an OOP-style `Timer` API, and the language gained `setTimeout`, `setInterval`, and `clearInterval`. These are particularly natural for Minecraft because scheduled functions already exist in vanilla; the compiler just has to generate the right helper functions and schedule commands.

### Dead code elimination

The compiler now removes unreachable functions, unused constants, dead branches with constant conditions, and unused local declarations reachable from the AST. For datapacks, this matters directly: fewer generated functions and fewer commands shipped into the final pack.

### 313 MC tag constants

The standard library now includes `313` generated Minecraft tag constants across block, entity, item, fluid, and damage categories. Instead of spelling raw `#minecraft:...` strings repeatedly, user code can refer to named constants like `BLOCK_LOGS` or `ENTITY_SKELETONS`.

---

## Technical Highlights

### Compilation pipeline

The core pipeline is now:

```text
Source
  -> Lexer
  -> Parser
  -> TypeChecker
  -> Lowering
  -> CodeGen
```

In practice there is optimization work between lowering and final emission, but the important point is that RedScript is not a template engine. It has a real front-end, typed AST, and an explicit lowering phase into a Minecraft-friendly IR.

### How `impl` blocks compile to prefixed functions

`impl` does not survive into runtime. Lowering rewrites:

```rs
impl Counter {
    fn inc(self, n: int) {}
}
```

into a normal lowered function name:

```text
Counter_inc(self, n)
```

That keeps code generation simple. The backend only needs to know about ordinary functions, parameter registers, and scoreboard-backed locals.

### How events compile to tick dispatchers

`@on(PlayerDeath)` gets attached to function metadata during lowering, then codegen emits dispatch logic inside `__tick.mcfunction`:

```mcfunction
execute as @a[tag=rs.just_died] run function ns:handle_death
tag @a[tag=rs.just_died] remove rs.just_died
```

This is a pragmatic model. Events are static, registration is compile-time, and dispatch stays explicit and inspectable in generated datapacks.

### How f-strings compile to `tellraw` JSON

For output builtins like `say`, `tellraw`, `actionbar`, and `title`, an f-string is split into text fragments and expression fragments. Text becomes `{"text":"..."}`. Integer expressions become scoreboard components:

```json
["", {"text":"Score: "}, {"score":{"name":"$score","objective":"rs"}}]
```

That is exactly what Minecraft wants. The compiler is effectively targeting the `tellraw` JSON AST instead of flattening everything into strings too early.

### DCE algorithm: mark-sweep from entry points

The AST dead code elimination pass works like a classic mark-sweep:

1. Find entry points such as `main`, `@tick`, `@load`, `@on(...)`, and trigger/advancement handlers.
2. Traverse calls from those roots and mark reachable functions.
3. Track constants and local declarations that are actually read.
4. Sweep everything else.

For a datapack compiler, this is especially useful because unused functions are not theoretical waste. They are extra `.mcfunction` files and extra commands the game has to load.

---

## Code Examples

### `impl` method calls

RedScript:

```rs
struct Timer {
    _id: int,
    _duration: int
}

impl Timer {
    fn new(duration: int) -> Timer {
        return { _id: 0, _duration: duration };
    }

    fn done(self) -> bool {
        return self._duration <= 0;
    }
}

fn test() -> bool {
    let timer: Timer = Timer::new(20);
    return timer.done();
}
```

Lowered call shape:

```text
call Timer_new(20)
call Timer_done(timer)
```

Generated mcfunction shape:

```mcfunction
scoreboard players set $p0 rs 20
function redscript:Timer_new
scoreboard players operation $timer rs = $ret rs
scoreboard players operation $p0 rs = $timer rs
function redscript:Timer_done
```

### Static events

RedScript:

```rs
@on(PlayerDeath)
fn handle_death(player: Player) {
    scoreboard_add(#event_test, #death_count, 1);
}
```

Generated dispatcher:

```mcfunction
execute as @a[tag=rs.just_died] run function redscript:handle_death
tag @a[tag=rs.just_died] remove rs.just_died
```

Inside the handler, `player` is lowered to `@s`, because the dispatcher already executes the function as the matching player.

### f-strings

RedScript:

```rs
fn test() {
    let score: int = 7;
    tellraw(@a, f"Score: {score}");
}
```

Generated command:

```mcfunction
tellraw @a ["",{"text":"Score: "},{"score":{"name":"$score","objective":"rs"}}]
```

This is a good example of why compiler structure matters. A string interpolation feature in a normal language becomes direct codegen for Minecraft's rich text format.

---

## Performance & Stats

Two concrete stats are visible in the repository today:

- the README badge reports `510 passing` tests on `main`
- the standard library now ships `313` generated Minecraft tag constants

The optimizer also exposes useful command-level counters through `redscript compile --stats`, including:

- LICM hoists
- common subexpression eliminations
- setblock-to-fill batching
- dead commands removed
- constant folds
- total command count before and after optimization

The README example shows one representative reduction from `34` generated commands to `28`, an `18%` drop. That is exactly the kind of gain DCE and command-level optimization are supposed to deliver in this domain: less datapack output, fewer helper files, and less scoreboard noise.

---

## Future Plans

The current event system is intentionally static. Dynamic subscribe/unsubscribe hooks would be possible, but they would require a more stateful runtime model and a more complex dispatcher.

Entity typing can also go much further. The current hierarchy already enables checks like `e is Player` and Minecraft-aware parameter validation, but there is room for more precise entity subtypes and richer selector-aware APIs.

IDE support is the third obvious frontier. The language already has a VSCode extension and an online IDE, but the compiler architecture now looks mature enough for deeper diagnostics, better hover/type information, and more aggressive compile-time feedback.

---

## Links

- GitHub: [https://github.com/bkmashiro/redscript](https://github.com/bkmashiro/redscript)
- Docs: [https://redscript-docs.pages.dev](https://redscript-docs.pages.dev)
- Online IDE: [https://redscript-ide.pages.dev](https://redscript-ide.pages.dev)
- npm: `redscript-mc`
- VSCode: `bkmashiro.redscript-vscode`
