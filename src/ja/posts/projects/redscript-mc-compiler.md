---
title: "RedScript：C言語スタイルのコードをMinecraft mcfunctionにコンパイルする"
description: "Minecraft Java Editionのデータパックをターゲットとするコンパイラの設計——エンティティセレクターをファーストクラス型として、foreachループをexecuteコマンドに変換し、@tickデコレーターでソフトウェアタイマーを生成する完全なLexer/Parser/IRパイプライン。"
date: 2026-03-12
readingTime: true
tag:
  - コンパイラ
  - Minecraft
  - TypeScript
  - 言語設計
  - IR
outline: [2, 3]
---

Minecraft Java Editionには驚くほど高機能なスクリプトレイヤーがある。スコアボードは整数レジスタとして機能し、NBTストレージは任意のヒープメモリで、`execute`コマンドチェーンは条件分岐だ。ゲーム内で動作するCPU、レイトレーサー、ソートアルゴリズムを作った人もいる。しかし直接このコードを書くのは苦痛だ——生の`.mcfunction`ファイルには変数も、ループも、抽象化もない。

そこでコンパイラを作った。[bkmashiro/redscript](https://github.com/bkmashiro/redscript)

## コードの見た目

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

`@tick(rate=20)`は毎秒一回関数を実行する。`foreach`はエンティティをイテレートする。`@on_trigger`はスコアボードトリガーを接続し、オペレーター権限のないプレイヤーが`/trigger claim_reward`で起動できるようにする。これはワールドにドロップするだけで使える有効なMinecraftデータパックにコンパイルされる。

## 設計上の決断

### エンティティセレクターをファーストクラス型として

バニラのmcfunctionでは、`@e[type=zombie,distance=..5]`はコマンドに埋め込まれた単なる文字列フラグメントだ。検証もなく、補完もなく、構造もない。

RedScriptでは、それは適切なASTノードだ：

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

範囲リテラル（`..5`、`1..`、`1..10`）は独自のトークン種別を持つ。字句解析器は`@`の次の文字が`a/e/s/p/r/n`に続いて非文字かどうかを確認することで、`@a`（セレクター）と`@tick`（デコレーター）を区別する。

### foreachはボディをサブ関数に展開しなければならない

Minecraftの`execute`コマンドは一つのコマンドのみ実行する：

```
execute as @e[type=zombie] run <単一コマンド>
```

複数のステートメントを含むforeachボディはインライン化できない。ローワリングパスがこれを検出し、ボディを`parent_fn/foreach_0`という名前の新しい`IRFunction`に展開し、コールサイトに`execute as <selector> run function ns:parent_fn/foreach_0`を生成する：

```mcfunction
# check_zombies.mcfunction
execute as @e[type=zombie, distance=..10] run function rs:check_zombies/foreach_0

# check_zombies/foreach_0.mcfunction
kill @s
```

### SSTではなくTAC

IRにはSSAではなく三アドレスコード（TAC）を選んだ。SSAの主な利点はレジスタ割り当てアルゴリズムを可能にすることだが、Minecraftのスコアボードにはレジスタ数の制限がない。フェイクプレイヤースコアは実質的に無限の名前付きスロットだ。SSAの複雑さのコストはここでは何も買わない。

変数はスコアボードのフェイクプレイヤーにマッピングされる：

```
$x rs          → 変数 x
$t0 rs         → 一時スロット 0
$ret rs        → 戻り値レジスタ
$p0 rs, $p1 rs → パラメータレジスタ
```

### @tick(rate=N) — ソフトウェアタイマー

`minecraft:tick`に関数を登録すると20Hzで実行される。低い周波数にはネイティブタイマーがないため、コンパイラがカウンタを生成する：

```mcfunction
# minecraft:tickに登録
scoreboard players add $__tick_slow_fn rs 1
execute if score $__tick_slow_fn rs matches 20.. run function rs:slow_fn
execute if score $__tick_slow_fn rs matches 20.. run scoreboard players set $__tick_slow_fn rs 0
```

`@tick(rate=20)` → 1Hz。`@tick(rate=200)` → 0.1Hz（10秒ごと）。カウンタは関数ごとで、衝突を避けるよう命名される。

## 完全なパイプライン

```
.rs ソース
  → 字句解析    （セレクター、範囲、デコレーター、キーワード）
  → 構文解析    （再帰下降、優先順位クライミング）
  → AST         （Program / FnDecl / Stmt / Expr）
  → ローワリング （AST → TAC IR、サブ関数展開）
  → オプティマイザ（定数畳み込み、DCE、コピー伝播）
  → コード生成  （IR → mcfunctionファイルツリー）
  → datapack/
```

191テスト、7スイート、全パス。

## CLI

```bash
redscript compile src/main.rs -o dist/mypack/
redscript compile src/main.rs --namespace mypack
redscript check src/main.rs      # ファイルを書かずに型チェック
redscript version
```

## 今後の展開

- `random(min, max)` → `/random value`（Java 1.21+）
- `entity.tag/untag/has_tag` — `/tag`によるエンティティステートマシン
- NBTストレージに裏打ちされた`struct`型
- `data modify storage ... append`による`int[]`配列
- 物理インパルス/チェーン/リピートコマンドブロックレイアウトの`.nbt`構造ファイル

最後のもの——アーマースタンドをオブジェクトインスタンスとして使い、スコアボードフィールドを持たせること——が最も興味深い機能だ。`let turret = spawn_object(x, y, z); turret.health -= 10;`が`execute as @e[tag=__rs_turret_0] run scoreboard players remove $health rs 10`にローワリングされる。Minecraft内のオブジェクト指向プログラミング。呪われているが、避けられない。
