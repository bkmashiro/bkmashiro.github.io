---
title: "RedScript v1.2.26：数学/向量标准库、BigInt 与编译器 Bug 修复"
date: 2026-03-14
tags: [编译器, minecraft, typescript, 编程语言, 数学]
description: "完整的数学/向量/高级标准库（sin、cos、sqrt、atan2、3D 向量、BigInt），module library 按需编译 pragma，动态 NBT 数组读写内置函数，以及多项编译器 Bug 修复。"
readingTime: true
tag:
  - 编译器
  - Minecraft
  - TypeScript
  - 编程语言
outline: [2, 3]
---

2026 年 3 月 14 日。一天时间从零搭建 RedScript 标准库——以及修复所有在途中发现的 Bug。

- GitHub: [bkmashiro/redscript](https://github.com/bkmashiro/redscript)
- npm: [redscript-mc](https://www.npmjs.com/package/redscript-mc)
- 文档: [redscript-docs.pages.dev](https://redscript-docs.pages.dev)
- 在线 IDE: [redscript-ide.pages.dev](https://redscript-ide.pages.dev)

---

## 标准库

RedScript 现在附带三个标准库文件，全部使用新增的 `module library;` pragma，因此默认会被树摇——未使用的函数完全不编译进输出包。

### math.mcrs

专为 Minecraft 积分榜纯整数运算环境设计的定点数学库：

| 函数 | 说明 |
|------|------|
| `abs(n)` | 绝对值 |
| `sign(n)` | -1、0 或 1 |
| `min(a,b)` / `max(a,b)` | 整数最小/最大值 |
| `clamp(n,lo,hi)` | 范围限制 |
| `lerp(a,b,t)` | 线性插值（t ∈ 0..1000） |
| `isqrt(n)` | 整数平方根 |
| `sqrt_fixed(n)` | `√n × 1000`（定点数） |
| `pow_int(base,exp)` | 整数幂 |
| `gcd(a,b)` / `lcm(a,b)` | 最大公约数 / 最小公倍数 |
| `sin_fixed(deg)` | `sin(deg) × 1000`，0–360° 表查询 |
| `cos_fixed(deg)` | `cos(deg) × 1000`，0–360° 表查询 |
| `map(n,a,b,c,d)` | 将 n 从 [a,b] 映射到 [c,d] |
| `ceil_div(a,b)` | 向上取整除法 |
| `log2_int(n)` | 向下取整的以 2 为底对数 |
| `mulfix(a,b)` | `a × b / 1000`（定点乘法） |
| `divfix(a,b)` | `a × 1000 / b`（定点除法） |
| `smoothstep(e0,e1,x)` | ×1000 定点平滑插值 |
| `smootherstep(e0,e1,x)` | Ken Perlin 的更平滑插值 |

`sin`/`cos` 函数使用 91 条目的 NBT 表，通过 `@require_on_load(_math_init)` 在世界加载时初始化一次（写入 `math:tables.sin`），之后每次调用只需一条 `data get storage` 指令。

```redscript
let s: int = sin_fixed(45);  // 707 ≈ sin(45°) × 1000
let c: int = cos_fixed(90);  // 0
```

### vec.mcrs

2D 和 3D 向量数学，全部采用 ×1000 定点数：

**2D：**
- `dot2d(ax,ay,bx,by)` / `cross2d(ax,ay,bx,by)`
- `length2d_fixed(x,y)` — `√(x²+y²) × 1000`
- `distance2d_fixed(ax,ay,bx,by)`
- `manhattan(ax,ay,bx,by)` / `chebyshev(ax,ay,bx,by)`
- `atan2_fixed(y,x)` — 二分搜索正切表，结果为毫度（millidegrees）
- `normalize2d_x/y(x,y)` — 单位向量 ×1000
- `rotate2d_x/y(x,y,deg)` — 使用 sin/cos 表旋转
- `lerp2d_x/y(ax,ay,bx,by,t)` — 插值两个 2D 点

**3D：**
- `dot3d(ax,ay,az,bx,by,bz)`
- `cross3d_x/y/z(ax,ay,az,bx,by,bz)`
- `length3d_fixed(x,y,z)`

```redscript
let angle: int = atan2_fixed(1000, 0);  // 90000 毫度 = 90°
let nx: int = normalize2d_x(3, 4);      // 600（= 0.6 × 1000）
```

### advanced.mcrs

数论、噪声、分形与几何实验：

- **数论**：`fib(n)`（迭代式）、`is_prime(n)`、`collatz_steps(n)`、`digit_sum(n)`、`reverse_int(n)`、`mod_pow(base,exp,mod)`
- **哈希/噪声**：`hash_int(x)`（splitmix32）、`noise1d(x,seed)`（确定性整数噪声）
- **曲线**：`bezier_quad(p0,p1,p2,t)` — t ∈ [0,1000] 的二次贝塞尔曲线
- **分形**：`mandelbrot_iter(cx,cy,max_iter)`、`julia_iter(zx,zy,cx,cy,max_iter)`
- **几何**：`angle_between(ax,ay,bx,by)`、`clamp_circle_x/y(x,y,r)`、`newton_sqrt(n)`、`digital_root(n)`、`spiral_ring(n)`

---

## `module library;` Pragma

让标准库真正可用的关键：将文件声明为库，其中的函数只在被实际调用时才编译进去。

```redscript
// math.mcrs
module library;

fn abs(n: int) -> int { ... }
fn sin_fixed(deg: int) -> int { ... }
// 另外 18 个函数...
```

没有 `module library;` 时，所有导入文件中的每个函数都会始终编译进去，导致输出包膨胀。有了它，DCE 阶段会将库函数视为非入口点——只有从公共函数可达时才保留。

用法：

```redscript
// main.mcrs — 只有 abs 和 sin_fixed 编译进来，其余全部消除
fn tick() {
    let d: int = abs(score - target);
    let s: int = sin_fixed(angle);
}
```

---

## 动态 NBT 数组访问

两个用于运行时数组索引的新内置函数：

### `storage_get_int(ns, key, index)`

使用运行时索引读取已存储 int 数组中的某个元素。内部利用 MC 的 `$execute` 宏机制：

```redscript
let val: int = storage_get_int("math:tables", "sin", deg / 4);
```

编译为宏子函数：
```mcfunction
execute store result storage rs:heap __sgi_0 int 1 run scoreboard players get $deg rs
function ns:fn/__sgi_1 with storage rs:heap
# __sgi_1:
$execute store result score $ret rs run data get storage math:tables sin[$(__sgi_0)] 1
```

### `storage_set_int(ns, key, index, value)`

对应的写操作，同时支持常量和运行时索引：

```redscript
// 常量索引 — 静态命令：
storage_set_int("rs:bigint", "a", 0, n % 10000);

// 运行时索引 — 宏子函数：
let i: int = compute_idx();
storage_set_int("rs:bigint", "a", i, value);
```

---

## BigInt：Minecraft 中的任意精度整数

新内置函数的真正压力测试：一个完全运行在 Minecraft 积分榜上的 32 位十进制任意精度整数库。

**表示方式：** 8 个 limb × 每 limb 基数 10,000 = 最大 10³² − 1（32 位十进制数）。存储为 `rs:bigint` data storage 中的 NBT int 数组。三个寄存器：`a`、`b`、`c`。

```redscript
bigint_init();
bigint_from_int_a(999999);   // a = 999,999
bigint_from_int_b(1);        // b = 1
bigint_add();                // c = a + b = 1,000,000
// c[0] = 0, c[1] = 100（= 100 × 10000 = 1,000,000）
```

**支持操作：**

| 函数 | 说明 |
|------|------|
| `bigint_init()` | 将所有寄存器置零 |
| `bigint_from_int_a/b(n)` | 从 int32 装填 |
| `bigint_add()` | `c = a + b`，含进位 |
| `bigint_sub()` | `c = a − b`，含借位 |
| `bigint_compare()` | `1 / 0 / -1` |
| `bigint_mul_small(k)` | `c = a × k`（k < 10000） |
| `bigint_mul()` | `c = a × b`，O(n²) |
| `bigint_fib(n)` | 斐波那契，结果在寄存器 `a` |

**斐波那契演示：**

```redscript
bigint_fib(50);
// a[0] = 9025, a[1] = 8626, a[2] = 125
// → F(50) = 12,586,269,025 ✓

bigint_fib(100);
// F(100) = 354,224,848,179,261,915,075
// 验证：a[0] = 5075, a[1] = 1507, ...  ✓
```

溢出分析：`bigint_mul` 内积最大值 = `9999 × 9999 + 9999 + 9999 = 99,999,999 < INT32_MAX`。✓

---

## Bug 修复

### `isqrt` — 大数不收敛

旧版 Newton 法使用 `x = n` 作为初始猜测。对于 `n = 360,000,000,000`（例如 `length2d_fixed(600000, 0)` 内部产生的值），需要 20+ 次迭代才能收敛——但循环只跑了 16 次。结果：大输入的平方根完全错误。

**修复：** 使用 `x = 2^⌈(bits+1)/2⌉` 作为初始猜测（始终是 `√n` 的上界）。Newton 法从上方收敛，对任意 32 位输入最多 8 次迭代即可。

```redscript
// 旧：x = n（大 n 需要 20+ 次迭代）
// 新：x = 2^((floor(log2(n))+2)/2) — 保证上界，≤8 次迭代
```

### 优化器拷贝传播

当写入 `$y` 时，只失效了 `copies[$y]`，而像 `copies[$x] = $y` 这样的别名仍然保留，导致后续读取 `$x` 使用了过时的值。

**修复：** 反向扫描——写入 `$y` 时，移除所有值为 `$y` 的 `copies[k]` 条目。

### 跨函数变量命名冲突

修复前：所有 lowering 后的 IR 变量直接使用原名（`$score`、`$n`）。两个函数各有一个名为 `score` 的局部变量，会在共享的积分榜上冲突。

**修复：** 函数作用域命名——`$score` → `$fnname_score`。临时变量（`$_0`、`$_1` 等）保持无作用域前缀，因为它们已经全局唯一。

### MCRuntime 数组正则

用于解析 NBT 路径中 `a[0]` 的正则 `(\S+)\[(\d+)\]` 有 Bug：`\S+` 贪婪地吃掉了整个 `a[0]` 字符串，导致 `\[` 永远匹配不到。

**修复：** 改为 `([^\[\s]+)\[(\d+)\]`——匹配方括号和空白符以外的所有字符。

### `preScanExpr` 宏函数误判

`preScanExpr` 的设计目的是识别哪些函数的参数被用在 MC 宏位置（如 `tp(target, ~$(height), 0)`）。问题在于它扫描了所有内置函数调用，包括 `storage_get_int`。因此任何包含 `storage_get_int(ns, key, i)` 的函数都被错误标记为"宏函数"，导致其调用方生成了错误的 `function ns:fn with storage rs:macro_args` 调用约定。

**修复：** 跳过 `() => null` 内置函数（`storage_get_int`/`storage_set_int` 等特殊处理函数）的宏参数检测。这些函数在内部自行管理宏间接，无需外层函数参与。

---

## 测试覆盖

| 测试套件 | 用例数 |
|---------|--------|
| 核心编译器（codegen、optimizer、lowering、e2e） | ~670 |
| stdlib-math | 53 |
| stdlib-vec | 66 |
| stdlib-advanced | 72 |
| **stdlib-bigint** | **26** |
| 其他 | ~30 |
| **合计** | **917** |

917 全部通过，0 失败。

---

## 下一步

- 针对大坐标的溢出安全 normalize/rotate（目前因 `x × 1,000,000` 中间值限制，输入坐标需 ≤ ~2000）
- `strings.mcrs` 和 `sets.mcrs` 清理
- 更多 BigInt 操作：位移、取模、字符串转换
