---
title: "RedScript v1.2.25: Entity Types, Variable Mangling, and CI Automation"
date: 2026-03-14
tags: [compiler, minecraft, typescript, programming-language]
description: "Entity type hierarchy with W_IMPOSSIBLE_AS warnings, is T narrowing, selector<T> annotations, scoreboard variable mangling ($a $b $c...), sourcemaps, and a fully automated CI/CD pipeline."
readingTime: true
tag:
  - Compiler
  - Minecraft
  - TypeScript
  - Programming Language
outline: [2, 3]
---

A lot happened in one day. This post covers the RedScript work from March 13, 2026 — from entity type safety all the way to CI/CD automation.

- GitHub: [bkmashiro/redscript](https://github.com/bkmashiro/redscript)
- npm: [redscript-mc](https://www.npmjs.com/package/redscript-mc)
- Docs: [redscript-docs.pages.dev](https://redscript-docs.pages.dev)
- Online IDE: [redscript-ide.pages.dev](https://redscript-ide.pages.dev)

---

## Entity Type System

The biggest addition: a compile-time entity type hierarchy modeled on Minecraft's entity registry.

```
Entity (base, abstract)
├── Player
├── Mob (abstract)
│   ├── HostileMob (abstract)
│   │   ├── Zombie, Skeleton, Creeper, Spider, Enderman, ...
│   └── PassiveMob (abstract)
│       ├── Pig, Cow, Sheep, Chicken, Villager, ...
├── ArmorStand
├── Item
└── Arrow
```

### W_IMPOSSIBLE_AS

The compiler now detects impossible type assertions at compile time. If you're already in a player context and try to switch to zombie, that block can never execute — the compiler warns you:

```rs
foreach (p in @a) {
    // @s: Player here

    as @e[type=zombie] {
        // W_IMPOSSIBLE_AS: @s is Player, but targeting Zombie
        // Player ≠ Zombie in the entity hierarchy → this never runs
        kill(@s);
    }
}
```

The rule: `as @e[type=X]` inside a context where `@s` is already a known incompatible type emits `W_IMPOSSIBLE_AS`. The code still compiles and runs (warnings never block), but you know something is logically wrong.

### Context-Aware @s

The compiler tracks what type `@s` is at every point in the program:

```rs
foreach (p in @a) {
    // @s: Player

    as @e[type=armor_stand] {
        // @s: ArmorStand

        as @e[type=zombie] {
            // @s: Zombie
        }

        // @s: ArmorStand (restored)
    }

    // @s: Player (restored)
}
```

Context is pushed/popped via a stack as you enter and exit `as` blocks.

### `is T` Type Narrowing

```rs
foreach (e in @e) {
    if (e is Player) {
        give(@s, "diamond", 1);  // ✅ @s is Player here
    }
    if (e is Zombie) {
        kill(@s);                // ✅ @s is Zombie here
    }
}
```

This compiles to Minecraft entity type checks:

```mcfunction
# concrete type → single check
execute if entity @s[type=minecraft:zombie] run function ns:branch

# abstract type (e.g. HostileMob) → expand to all concrete subtypes
scoreboard players set __is_result rs:temp 0
execute if entity @s[type=minecraft:zombie] run scoreboard players set __is_result rs:temp 1
execute if entity @s[type=minecraft:skeleton] run scoreboard players set __is_result rs:temp 1
execute if entity @s[type=minecraft:creeper] run scoreboard players set __is_result rs:temp 1
# ... all hostile mobs
execute if score __is_result rs:temp matches 1 run function ns:branch
```

### `selector<T>` Type Annotations

Function parameters can now be annotated with a specific entity type:

```rs
fn buff(targets: selector<Player>) { ... }       // only accepts players
fn killMobs(targets: selector<Mob>) { ... }      // accepts any Mob subtype
fn doAnything(e: selector<Entity>) { ... }       // accepts everything
```

The type system is covariant: `selector<Zombie>` can be passed where `selector<Mob>` is expected, since `Zombie extends Mob`.

---

## Variable Name Mangling

Before this change, RedScript compiled `let counter: int = 0` to a scoreboard variable named `$counter`. This meant user-defined variables could conflict with compiler-generated names like `$const_0`, `$p0`, or `$ret`.

Now the compiler uses a sequential allocator — same approach as JS minifiers like Terser:

```
counter  →  $a
running  →  $b
const 0  →  $c
const 1  →  $d
const 20 →  $e
__ret    →  $f
```

**Zero collision risk.** The allocator assigns names from a shared pool in order (`a, b, c, ..., z, aa, ab, ...`), and caches them so the same variable always gets the same name.

### `--no-mangle` for Debugging

```bash
redscript compile main.mcrs --no-mangle
```

Produces readable names: `$rs_counter`, `$rs_running`, `$__c_0`, etc. Useful when you need to inspect scoreboard values in-game with `/scoreboard players list`.

### Sourcemap

When mangle mode is active (the default), the compiler writes a `.map.json` alongside the datapack:

```json
{
  "$a": "counter",
  "$b": "running",
  "$c": "const:0",
  "$d": "const:1",
  "$f": "internal:ret"
}
```

Compiler-generated temporaries (`_0`, `_1`, SSA intermediate values) are filtered out — only user-visible variables appear.

---

## Other Fixes

**Constant deduplication in `__load`:** Previously, if multiple functions used the constant `1`, the `__load` function would contain `scoreboard players set $const_1 rs 1` multiple times (once per function). Now all constants are collected across all functions first, deduplicated, and emitted once.

**Empty continuation blocks:** Some `if/else` branches produced `.mcfunction` files containing only a comment (`# block: then_0`) with no real commands. These are now skipped entirely — no file is written for empty continuation blocks.

---

## CI/CD Automation

The full release pipeline is now automated:

```
git push to main
    ↓
CI runs tests (684 passing)
    ↓ (success)
Publish workflow triggers
    ↓
1. Bump VSCode extension version → commit → push
2. npm publish redscript-mc (skips if version already published)
3. vsce publish VSCode extension
4. repository_dispatch → redscript-ide
              ↓
        update-compiler.yml
          ├── npm install redscript-mc@latest
          ├── node build.mjs
          └── wrangler pages deploy
```

A push to `main` is all it takes. npm, VSCode Marketplace, and the online IDE all update automatically.

---

## By the Numbers

- **684 tests** passing across 22 suites
- **28 entity types** in the hierarchy (14 hostile, 6 passive, + abstract nodes)
- **4 new warning codes**: `W_IMPOSSIBLE_AS`, `W_UNKNOWN_ENTITY_TYPE`
- npm: `redscript-mc@1.2.25`
- VSCode: `bkmashiro.redscript-vscode@1.0.13`
