---
title: "RedScript v1.2.27: BigInt Verified in Real Minecraft"
date: 2026-03-14
tags: [compiler, minecraft, typescript, programming-language, bugfix]
description: "BigInt arbitrary-precision integers now confirmed working on Paper 1.21.4. Root cause: a Minecraft macro substitution bug with integer values silently corrupted all NBT array writes. Fixed by switching to execute store result storage."
readingTime: true
tag:
  - Compiler
  - Minecraft
  - TypeScript
  - Programming Language
outline: [2, 3]
---

Same day as v1.2.26 — but a real bug needed fixing before BigInt could actually run.

- GitHub: [bkmashiro/redscript](https://github.com/bkmashiro/redscript)
- npm: [redscript-mc](https://www.npmjs.com/package/redscript-mc)
- Docs: [redscript-docs.pages.dev](https://redscript-docs.pages.dev)
- Online IDE: [redscript-ide.pages.dev](https://redscript-ide.pages.dev)

---

## The Bug: BigInt All Zeros in Real Minecraft

After shipping `bigint.mcrs` in v1.2.26 with all 26 unit tests passing, the first real-server test returned this:

```
/function showcase:debug_bigint
[5] fib(10) → get_a(0)=0   (expect 55)
[6] fib(20) → get_a(0)=0   (expect 6765)
```

Every BigInt output was 0. The simulator passed; Paper 1.21.4 did not.

## Diagnosis

The test progression narrowed it down quickly:

**Step 1 — Scoreboard works?** Yes. A direct `scoreboard players set $x rs 9999` + read back returned 9999.

**Step 2 — Raw MC commands work?** Yes. Manually running:
```mcfunction
/scoreboard players set $testvar rs 777
/data modify storage rs:bigint a set value [0,0,0,0,0,0,0,0]
/execute store result storage rs:bigint a[0] int 1 run scoreboard players get $testvar rs
/data get storage rs:bigint a
```
returned `[777, 0, 0, 0, 0, 0, 0, 0]`. The commands themselves work.

**Step 3 — But `bigint_from_int_a` writes nothing?** After calling the function, `/data get storage rs:bigint a` showed `[0, 0, 0, 0, 0, 0, 0, 0]`. The write was happening but storing 0.

The compiled `bigint_add` loop used this pattern for its dynamic-index writes:

```mcfunction
# __ssi_6.mcfunction (macro sub-function)
$data modify storage rs:bigint c[$(__ssi_i_4)] set value $(__ssi_v_5)
```

The `$(val)` macro substitution — where `val` is an integer stored in `rs:heap` — **silently failed** in Minecraft 1.21.4. The command ran (no error), but the value was not applied. Result: all writes stored 0.

## Root Cause: Minecraft Macro Substitution Bug with Integer Values

The `$data modify storage ... set value $(n)` pattern is supposed to substitute `$(n)` with an integer from the macro compound and write it as NBT. In practice, on Paper 1.21.4, this substitution either fails silently or the substituted value is not interpreted as a TAG_Int by the NBT parser.

## Fix

Replace the value-substitution macro with a scoreboard-based write:

```typescript
// BEFORE: macro substitutes the value
this.emitRawSubFunction(subFnName,
  `\x01data modify storage ${ns} ${key}[$(${macroIdxKey})] set value $(${macroValKey})`
)

// AFTER: only the index is macro-substituted; value is read from scoreboard slot
this.emitRawSubFunction(subFnName,
  `\x01execute store result storage ${ns} ${key}[$(${macroIdxKey})] int 1 run scoreboard players get ${valVar} rs`
)
```

Only the **array index** is now macro-substituted. The **value** is read directly from the scoreboard using a hardcoded slot name compiled into the sub-function at compile time. This is unambiguous and works correctly in all tested MC versions.

One subtlety: the optimizer would DCE (dead code eliminate) the `valVar` assignment because the variable only appeared as a literal string inside the macro sub-function — invisible to the IR optimizer. The fix also emits a dummy `execute store result storage rs:heap ${macroValKey} int 1 run scoreboard players get ${valVar} rs` line in the main function body to keep the variable "live" from the optimizer's perspective.

## A Second Bug: Mangle Slot Instability

While debugging, we discovered that adding the `debug_bigint` function to `showcase.mcrs` introduced a new constant (`9999`), which shifted the entire mangle table by one slot. This caused the argument-passing register (`p0`) to change from `$al` to `$am` in the new compilation — but only in the caller. The callee (`bigint_from_int_a`) was compiled from an older version and still read from `$al`.

The lesson: **always recompile the entire datapack from a single compilation run**. Mixed-version deployments (some files from one compile, others from another) break the calling convention.

This is a known limitation of the current name mangling design. Future versions may use stable semantic names for internal registers.

## Results

After the fix, all BigInt operations verified correct on Paper 1.21.4:

```
fib(0)  = 0     ✓
fib(5)  = 5     ✓
fib(10) = 55    ✓
fib(15) = 610   ✓
fib(20) = 6765  ✓
fib(50) = 12586269025  ✓ (3 NBT limbs: 9025, 8626, 125)
```

918 unit tests pass. BigInt is live.

## Other Fixes in v1.2.27

**`atan2_fixed` return type clarification**: the function returns integer degrees (0–360), not millidegrees×1000. The showcase example was incorrectly dividing the result by 1000.

**`mod_pow` overflow documentation**: `mod_pow(base, exp, m)` uses `b*b % m` internally. For `m > 46340`, the product `b*b` can exceed INT32_MAX (2,147,483,647) — Minecraft's scoreboard is 32-bit. Changed showcase examples to use small-modulus cases: `mod_pow(2, 10, 1000) = 24` and `mod_pow(7, 5, 13) = 11`.

---

## Upgrade

```bash
npm install -g redscript-mc@1.2.27
```

Or use the [Online IDE](https://redscript-ide.pages.dev) — no install needed.
