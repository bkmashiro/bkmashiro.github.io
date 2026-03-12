---
title: "RedScript: Compiling a C-Style Language to Minecraft mcfunction"
description: "Designing a compiler that targets Minecraft Java Edition datapacks — entity selectors as first-class types, foreach loops that lower to execute commands, @tick decorators with software-timer codegen, and a full Lexer/Parser/IR pipeline built in one session."
date: 2026-03-12
readingTime: true
tag:
  - Compiler
  - Minecraft
  - TypeScript
  - Language Design
  - IR
outline: [2, 3]
---

Minecraft Java Edition has a surprisingly capable scripting layer. Scoreboards act as integer registers. NBT storage is arbitrary heap memory. The `execute` command chains are conditional branches. People have built working CPUs, ray tracers, and sorting algorithms inside the game. But writing this code directly is miserable — raw `.mcfunction` files with no variables, no loops, no abstraction.

So I built a compiler. [bkmashiro/redscript](https://github.com/bkmashiro/redscript)

## What it looks like

```c
@tick(rate=20)
fn check_zombies() {
    foreach (z in @e[type=zombie, distance=..10]) {
        kill(z);
    }
}

@on_trigger("claim_reward")
fn handle_claim() {
    give(@s, "minecraft:diamond", 1);
    title(@s, "Zombie Slayer!");
}
```

`@tick(rate=20)` runs the function once per second. `foreach` iterates over entities. `@on_trigger` wires up a scoreboard trigger so non-operator players can activate it with `/trigger claim_reward`. This compiles to a valid Minecraft datapack you drop into your world.

## Design decisions

### Entity selectors as a first-class type

In vanilla mcfunction, `@e[type=zombie,distance=..5]` is just a string fragment embedded in commands. There's no validation, no completion, no structure.

In RedScript it's a proper AST node:

```ts
interface EntitySelector {
  kind: '@a' | '@e' | '@s' | '@p' | '@r' | '@n'
  filters?: {
    type?: string
    distance?: RangeExpr     // ..5, 1.., 1..10
    tag?: string[]
    notTag?: string[]        // tag=!excluded
    scores?: Record<string, RangeExpr>
    limit?: number
    sort?: 'nearest' | 'furthest' | 'random' | 'arbitrary'
    nbt?: string
  }
}
```

Range literals (`..5`, `1..`, `1..10`) are their own token kind. The lexer disambiguates `@a` (selector) from `@tick` (decorator) by checking whether the character after `@` is one of `a/e/s/p/r/n` followed by a non-letter. The parser handles `tag=!excluded` negation as `notTag`. This is the foundation for future type checking and IDE tooling.

### foreach must extract the body into a sub-function

Minecraft's `execute` command runs exactly one command:

```
execute as @e[type=zombie] run <SINGLE_COMMAND>
```

A foreach body with multiple statements can't be inlined. The lowering pass detects this and extracts the body into a new `IRFunction` named `parent_fn/foreach_0`, then emits a raw `execute as <selector> run function ns:parent_fn/foreach_0` at the call site:

```mcfunction
# check_zombies.mcfunction
execute as @e[type=zombie, distance=..10] run function rs:check_zombies/foreach_0

# check_zombies/foreach_0.mcfunction
kill @s
```

This generalises to `as (sel) { ... }` and `at (sel) { ... }` blocks too — any block that needs `execute ... run` with multiple commands behind it gets lifted to a sub-function.

### TAC not SSA

I chose three-address code for the IR rather than SSA. The main benefit of SSA is enabling register allocation algorithms — but Minecraft scoreboards have no register limit. Fake player scores are effectively infinite named slots. There's nothing to allocate. SSA's complexity cost buys nothing here.

Variables map to scoreboard fake players:

```
$x rs          → the variable x
$t0 rs         → temp slot 0
$ret rs        → return value register
$p0 rs, $p1 rs → parameter registers
```

All in the same `rs` objective. The IR has explicit basic blocks and unconditional/conditional jumps, which the codegen turns into separate mcfunction files that call each other (since MC has no `goto`, each basic block becomes a function that calls its successor).

### @tick(rate=N) — software timer

Registering a function in `minecraft:tick` runs it every game tick at 20Hz. For lower frequencies, there's no native timer — so the compiler generates a counter:

```mcfunction
# registered to minecraft:tick
scoreboard players add $__tick_slow_fn rs 1
execute if score $__tick_slow_fn rs matches 20.. run function rs:slow_fn
execute if score $__tick_slow_fn rs matches 20.. run scoreboard players set $__tick_slow_fn rs 0
```

`@tick(rate=20)` → 1Hz. `@tick(rate=200)` → 0.1Hz (every 10 seconds). The counter is per-function, named to avoid collisions.

### Builtins bypass the IR

User-defined functions go through the full pipeline: lowering → basic blocks → optimizer passes → codegen. Builtin commands (`say`, `kill`, `give`, `effect`, `summon`, etc.) bypass it entirely — they're macros that directly emit a known MC command string:

```ts
const BUILTINS = {
  say:    ([msg]) => `say ${msg}`,
  kill:   ([sel]) => `kill ${sel ?? '@s'}`,
  give:   ([sel, item, count]) => `give ${sel} ${item} ${count ?? 1}`,
  effect: ([sel, eff, dur, amp]) => `effect give ${sel} ${eff} ${dur} ${amp}`,
}
```

There's also `raw(cmd)` — a string that passes verbatim to the output `.mcfunction`. For when the compiler doesn't support what you need yet (complex NBT selectors, etc.).

### /trigger — non-operator player input

Normally, players cannot modify their own scoreboard scores. `trigger`-type objectives are the exception: the server can `enable` them per-player, and that player can then run `/trigger <name>` to increment their score (it auto-disables after, until the server re-enables it).

This is the only sanctioned player→datapack communication channel without granting operator permissions. A shop, a menu, a request button — anything that needs player input — goes through trigger.

```c
@on_trigger("open_shop")
fn handle_shop() {
    give(@s, "minecraft:bread", 3);
    tell(@s, "Here's your bread.");
}
```

Generated output:
- `load.mcfunction`: `scoreboard objectives add open_shop trigger` + `scoreboard players enable @a open_shop`
- A per-tick check: `execute as @a[scores={open_shop=1..}] run function rs:__trigger_open_shop_dispatch`
- Dispatch: call handler → reset score → re-enable for this player

The programmer just writes `@on_trigger`, the compiler handles the boilerplate.

## The full pipeline

```
.rs source
  → Lexer         (selectors, ranges, decorators, keywords)
  → Parser        (recursive descent, precedence climbing)
  → AST           (Program / FnDecl / Stmt / Expr)
  → Lowering      (AST → TAC IR, sub-function extraction)
  → Optimizer     (constant folding, DCE, copy propagation)
  → Codegen       (IR → mcfunction file tree)
  → datapack/
```

191 tests, 7 suites, all passing.

## CLI

```bash
redscript compile src/main.rs -o dist/mypack/
redscript compile src/main.rs --namespace mypack
redscript check src/main.rs      # type-check without writing files
redscript version
```

## What's next

- `random(min, max)` → `/random value` (Java 1.21+), `execute store result`
- `entity.tag/untag/has_tag` — entity state machines via `/tag`
- `struct` types backed by NBT storage
- `int[]` arrays via `data modify storage ... append`
- `--target cmdblock` → `.nbt` structure files with physical Impulse/Chain/Repeat block layouts
- World objects: invisible marker armor stands as class instances

That last one — using armor stands as object instances with scoreboard fields — is the feature I'm most interested in. `let turret = spawn_object(x, y, z); turret.health -= 10;` lowering to `execute as @e[tag=__rs_turret_0] run scoreboard players remove $health rs 10`. It's OOP inside Minecraft. Cursed and inevitable.
