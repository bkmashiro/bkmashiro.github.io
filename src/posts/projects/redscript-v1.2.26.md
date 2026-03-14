---
title: "RedScript v1.2.26: Math & Vector Stdlib, BigInt, and Compiler Bug Fixes"
date: 2026-03-14
tags: [compiler, minecraft, typescript, programming-language, math]
description: "A complete math/vector/advanced standard library (sin, cos, sqrt, atan2, 3D vectors, BigInt), the module library pragma for tree-shaking, dynamic NBT array read/write builtins, and several compiler bug fixes."
readingTime: true
tag:
  - Compiler
  - Minecraft
  - TypeScript
  - Programming Language
outline: [2, 3]
---

March 14, 2026. A day spent building RedScript's standard library from scratch — and fixing everything that broke along the way.

- GitHub: [bkmashiro/redscript](https://github.com/bkmashiro/redscript)
- npm: [redscript-mc](https://www.npmjs.com/package/redscript-mc)
- Docs: [redscript-docs.pages.dev](https://redscript-docs.pages.dev)
- Online IDE: [redscript-ide.pages.dev](https://redscript-ide.pages.dev)

---

## Standard Library

RedScript now ships three stdlib files, each using the new `module library;` pragma so they're tree-shaken by default — unused functions compile out completely.

### math.mcrs

Fixed-point integer math for Minecraft's scoreboard-only arithmetic environment:

| Function | Description |
|----------|-------------|
| `abs(n)` | Absolute value |
| `sign(n)` | -1, 0, or 1 |
| `min(a,b)` / `max(a,b)` | Integer min/max |
| `clamp(n,lo,hi)` | Range clamp |
| `lerp(a,b,t)` | Linear interpolation (t in 0..1000) |
| `isqrt(n)` | Integer square root |
| `sqrt_fixed(n)` | `√n × 1000` (fixed-point) |
| `pow_int(base,exp)` | Integer power |
| `gcd(a,b)` / `lcm(a,b)` | GCD and LCM |
| `sin_fixed(deg)` | `sin(deg) × 1000`, 0–360° table lookup |
| `cos_fixed(deg)` | `cos(deg) × 1000`, 0–360° table lookup |
| `map(n,a,b,c,d)` | Remap from range [a,b] to [c,d] |
| `ceil_div(a,b)` | Ceiling integer division |
| `log2_int(n)` | Floor log base-2 |
| `mulfix(a,b)` | `a × b / 1000` (fixed-point multiply) |
| `divfix(a,b)` | `a × 1000 / b` (fixed-point divide) |
| `smoothstep(e0,e1,x)` | Smoothstep in ×1000 fixed-point |
| `smootherstep(e0,e1,x)` | Ken Perlin's smootherstep |

The `sin`/`cos` functions use a 91-entry NBT table initialized via `@require_on_load(_math_init)` — it writes once to `math:tables.sin` on world load, then every call is a single `data get storage` lookup.

```redscript
let s: int = sin_fixed(45);  // 707 ≈ sin(45°) × 1000
let c: int = cos_fixed(90);  // 0
```

### vec.mcrs

2D and 3D vector math, all in ×1000 fixed-point:

**2D:**
- `dot2d(ax,ay,bx,by)` / `cross2d(ax,ay,bx,by)`
- `length2d_fixed(x,y)` — `√(x²+y²) × 1000`
- `distance2d_fixed(ax,ay,bx,by)`
- `manhattan(ax,ay,bx,by)` / `chebyshev(ax,ay,bx,by)`
- `atan2_fixed(y,x)` — angle in millidegrees via binary search on tan table
- `normalize2d_x/y(x,y)` — unit vector ×1000
- `rotate2d_x/y(x,y,deg)` — rotate by degrees using sin/cos table
- `lerp2d_x/y(ax,ay,bx,by,t)` — interpolate two 2D points

**3D:**
- `dot3d(ax,ay,az,bx,by,bz)`
- `cross3d_x/y/z(ax,ay,az,bx,by,bz)`
- `length3d_fixed(x,y,z)`

```redscript
let angle: int = atan2_fixed(1000, 0);  // 90000 millidegrees = 90°
let nx: int = normalize2d_x(3, 4);      // 600 (= 0.6 × 1000)
```

### advanced.mcrs

Number theory, noise, fractals, and geometry experiments:

- **Number theory**: `fib(n)` (iterative), `is_prime(n)`, `collatz_steps(n)`, `digit_sum(n)`, `reverse_int(n)`, `mod_pow(base,exp,mod)`
- **Hash / noise**: `hash_int(x)` (splitmix32), `noise1d(x,seed)` (deterministic integer noise)
- **Curves**: `bezier_quad(p0,p1,p2,t)` — quadratic Bézier at t ∈ [0,1000]
- **Fractals**: `mandelbrot_iter(cx,cy,max_iter)`, `julia_iter(zx,zy,cx,cy,max_iter)`
- **Geometry**: `angle_between(ax,ay,bx,by)`, `clamp_circle_x/y(x,y,r)`, `newton_sqrt(n)`, `digital_root(n)`, `spiral_ring(n)`

---

## `module library;` Pragma

The key that makes stdlib work: declare a file as a library, and its functions are only compiled in when actually called.

```redscript
// math.mcrs
module library;

fn abs(n: int) -> int { ... }
fn sin_fixed(deg: int) -> int { ... }
// 18 more functions...
```

Without `module library;`, every function in every imported file would always compile in, bloating every output pack. With it, the DCE pass treats library functions as non-entry-points — they're only kept if reachable from a public function.

Usage:

```redscript
// main.mcrs — only abs and sin_fixed compile in; rest are eliminated
fn tick() {
    let d: int = abs(score - target);
    let s: int = sin_fixed(angle);
}
```

---

## Dynamic NBT Array Access

Two new builtins for runtime array indexing in NBT storage:

### `storage_get_int(ns, key, index)`

Reads one element from a stored int array using a runtime index. Internally uses MC's `$execute` macro mechanism:

```redscript
let val: int = storage_get_int("math:tables", "sin", deg / 4);
```

Compiles to a macro sub-function:
```mcfunction
execute store result storage rs:heap __sgi_0 int 1 run scoreboard players get $deg rs
function ns:fn/__sgi_1 with storage rs:heap
# __sgi_1:
$execute store result score $ret rs run data get storage math:tables sin[$(__sgi_0)] 1
```

### `storage_set_int(ns, key, index, value)`

The write counterpart. Supports both const and runtime indices:

```redscript
// Const index — static command:
storage_set_int("rs:bigint", "a", 0, n % 10000);

// Runtime index — macro sub-function:
let i: int = compute_idx();
storage_set_int("rs:bigint", "a", i, value);
```

---

## BigInt: Arbitrary Precision in Minecraft

The real stress test for the new builtins: a 32-digit arbitrary precision integer library running entirely on Minecraft's scoreboard.

**Representation:** 8 limbs × base 10,000 per limb = up to 10³² − 1 (32 decimal digits). Stored as NBT int arrays in `rs:bigint` data storage. Three registers: `a`, `b`, `c`.

```redscript
bigint_init();
bigint_from_int_a(999999);   // a = 999,999
bigint_from_int_b(1);        // b = 1
bigint_add();                // c = a + b = 1,000,000
// c[0] = 0, c[1] = 100 (= 100 × 10000 = 1,000,000)
```

**Operations:**

| Function | Description |
|----------|-------------|
| `bigint_init()` | Zero all registers |
| `bigint_from_int_a/b(n)` | Load from int32 |
| `bigint_add()` | `c = a + b` with carry |
| `bigint_sub()` | `c = a − b` with borrow |
| `bigint_compare()` | `1 / 0 / -1` |
| `bigint_mul_small(k)` | `c = a × k` (k < 10000) |
| `bigint_mul()` | `c = a × b`, O(n²) |
| `bigint_fib(n)` | Fibonacci in register `a` |

**Fibonacci demo:**

```redscript
bigint_fib(50);
// a[0] = 9025, a[1] = 8626, a[2] = 125
// → F(50) = 12,586,269,025 ✓

bigint_fib(100);
// F(100) = 354,224,848,179,261,915,075
// Verified: a[0] = 5075, a[1] = 1507, ...  ✓
```

Overflow analysis: `bigint_mul` inner product = `ai × bj + ck + carry` ≤ `9999 × 9999 + 9999 + 9999 = 99,999,999 < INT32_MAX`. ✓

---

## Bug Fixes

### `isqrt` — Large Number Non-Convergence

The old Newton's method used `x = n` as the initial guess. For `n = 360,000,000,000` (e.g., from `length2d_fixed(600000, 0)` internally), this needed 20+ iterations to converge — but the loop only ran 16. Result: wildly wrong square roots for large inputs.

**Fix:** Use `x = 2^⌈(bits+1)/2⌉` as the initial guess (always an upper bound on `√n`). Newton's method converges from above in at most 8 iterations for any 32-bit input.

```redscript
// Old: x = n (takes 20+ iterations for large n)
// New: x = 2^((floor(log2(n))+2)/2) — guaranteed upper bound, ≤8 iterations
```

### Optimizer Copy Propagation

When `$y` was written to, only `copies[$y]` was invalidated. Aliases like `copies[$x] = $y` were left intact, so subsequent reads of `$x` would use a stale value.

**Fix:** Reverse scan — when writing `$y`, remove all entries `copies[k]` where the value was `$y`.

### Cross-Function Variable Collision

Before: all lowered IR variables used the name directly (`$score`, `$n`). Two functions with a local named `score` would both emit `$score`, colliding on the shared scoreboard.

**Fix:** Function-scoped naming — `$score` → `$fnname_score`. Fresh temporaries (`$_0`, `$_1`, ...) remain unscoped since they're already unique.

### MCRuntime Array Regex

The regex `(\S+)\[(\d+)\]` was used to parse `a[0]` in NBT paths. Problem: `\S+` greedily consumed the entire `a[0]` string, so `\[` never matched.

**Fix:** `([^\[\s]+)\[(\d+)\]` — match everything except brackets and whitespace before `[`.

### `preScanExpr` Macro Function Misdetection

`preScanExpr` was supposed to identify functions whose parameters are used in MC macro positions (e.g., `tp(target, ~$(height), 0)`). It was scanning ALL builtin calls, including `storage_get_int`. So any function with `storage_get_int(ns, key, i)` was flagged as a "macro function," causing its callers to generate the wrong `function ns:fn with storage rs:macro_args` call convention.

**Fix:** Skip `() => null` builtins (special-handled ones like `storage_get_int`/`storage_set_int`) from macro param detection. These manage their own macro indirection internally.

---

## Test Coverage

| Test Suite | Tests |
|-----------|-------|
| Core compiler (codegen, optimizer, lowering, e2e) | ~670 |
| stdlib-math | 53 |
| stdlib-vec | 66 |
| stdlib-advanced | 72 |
| **stdlib-bigint** | **26** |
| Other | ~30 |
| **Total** | **917** |

All 917 passing. 0 failing.

---

## What's Next

- Overflow-safe normalize/rotate for large coordinates (currently limited to ~2000 block coords due to `x × 1,000,000` intermediate)
- `strings.mcrs` and `sets.mcrs` cleanup
- More BigInt operations: shift, modulo, string conversion
