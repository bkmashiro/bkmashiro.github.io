---
title: "RedScript：C言語風の言語をMinecraft mcfunctionにコンパイルする"
description: "Minecraft Java Editionのデータパックをターゲットとするコンパイラを設計——エンティティセレクタを第一級型として、foreachループをexecuteコマンドに展開し、@tickデコレータでソフトウェアタイマーのコード生成を行い、1セッションで完全なLexer/Parser/IRパイプラインを構築。"
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

Minecraft Java Editionには驚くほど強力なスクリプト層がある。スコアボードは整数レジスタとして機能する。NBTストレージは任意のヒープメモリだ。`execute`コマンドチェーンは条件分岐だ。人々はゲーム内で動作するCPU、レイトレーサー、ソートアルゴリズムを構築してきた。しかしこのコードを直接書くのは苦痛だ——生の`.mcfunction`ファイルには変数もループも抽象化もない。

そこでコンパイラを作った。[bkmashiro/redscript](https://github.com/bkmashiro/redscript)

## どのように見えるか

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

`@tick(rate=20)`は関数を毎秒1回実行する。`foreach`はエンティティを反復処理する。`@on_trigger`はスコアボードトリガーを接続し、非オペレーターのプレイヤーが`/trigger claim_reward`で起動できるようにする。これは有効なMinecraftデータパックにコンパイルされ、ワールドにドロップできる。

## 設計決定

### エンティティセレクタを第一級型として

バニラのmcfunctionでは、`@e[type=zombie,distance=..5]`はコマンドに埋め込まれた単なる文字列フラグメントだ。検証もなく、補完もなく、構造もない。

RedScriptでは適切なASTノードだ：

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

範囲リテラル（`..5`、`1..`、`1..10`）は独自のトークン種別だ。レキサーは`@`の後の文字が`a/e/s/p/r/n`のいずれかで、その後に文字が続かないかをチェックして`@a`（セレクタ）と`@tick`（デコレータ）を区別する。パーサーは`tag=!excluded`の否定を`notTag`として処理する。これは将来の型チェックとIDEツールの基盤だ。

### foreachはボディをサブ関数として抽出する必要がある

Minecraftの`execute`コマンドは正確に1つのコマンドを実行する：

```
execute as @e[type=zombie] run <単一コマンド>
```

複数のステートメントを持つforeachボディはインライン化できない。lowering（展開）パスはこれを検出し、ボディを`parent_fn/foreach_0`という名前の新しい`IRFunction`として抽出し、呼び出し元で生の`execute as <selector> run function ns:parent_fn/foreach_0`を出力する：

```mcfunction
# check_zombies.mcfunction
execute as @e[type=zombie, distance=..10] run function rs:check_zombies/foreach_0

# check_zombies/foreach_0.mcfunction
kill @s
```

これは`as (sel) { ... }`と`at (sel) { ... }`ブロックにも一般化される——`execute ... run`で複数のコマンドを背後に持つ必要のあるブロックはサブ関数に昇格される。

### SSAではなくTAC

IRとして静的単一代入（SSA）ではなく三番地コード（TAC）を選択した。SSAの主な利点はレジスタ割り当てアルゴリズムを可能にすることだ——しかしMinecraftのスコアボードにはレジスタ制限がない。フェイクプレイヤースコアは事実上無限の名前付きスロットだ。割り当てるものがない。SSAの複雑さのコストはここでは何も買わない。

変数はスコアボードのフェイクプレイヤーにマップされる：

```
$x rs          → 変数 x
$t0 rs         → 一時スロット 0
$ret rs        → 戻り値レジスタ
$p0 rs, $p1 rs → パラメータレジスタ
```

すべて同じ`rs`オブジェクティブ内。IRには明示的な基本ブロックと無条件/条件ジャンプがあり、コード生成器はそれを相互に呼び出す別々のmcfunctionファイルに変換する（MCには`goto`がないため、各基本ブロックは後続を呼び出す関数になる）。

### @tick(rate=N) — ソフトウェアタイマー

関数を`minecraft:tick`に登録すると、20Hzで毎ゲームティック実行される。より低い頻度にはネイティブタイマーがない——そのためコンパイラはカウンターを生成する：

```mcfunction
# minecraft:tickに登録
scoreboard players add $__tick_slow_fn rs 1
execute if score $__tick_slow_fn rs matches 20.. run function rs:slow_fn
execute if score $__tick_slow_fn rs matches 20.. run scoreboard players set $__tick_slow_fn rs 0
```

`@tick(rate=20)` → 1Hz。`@tick(rate=200)` → 0.1Hz（10秒ごと）。カウンターは関数ごとに命名され、衝突を回避する。

### ビルトインはIRをバイパスする

ユーザー定義関数は完全なパイプラインを通過する：lowering → 基本ブロック → オプティマイザパス → コード生成。ビルトインコマンド（`say`、`kill`、`give`、`effect`、`summon`など）は完全にバイパスする——既知のMCコマンド文字列を直接出力するマクロだ：

```ts
const BUILTINS = {
  say:    ([msg]) => `say ${msg}`,
  kill:   ([sel]) => `kill ${sel ?? '@s'}`,
  give:   ([sel, item, count]) => `give ${sel} ${item} ${count ?? 1}`,
  effect: ([sel, eff, dur, amp]) => `effect give ${sel} ${eff} ${dur} ${amp}`,
}
```

`raw(cmd)`もある——出力`.mcfunction`にそのまま渡される文字列。コンパイラがまだサポートしていないもの（複雑なNBTセレクタなど）用。

### /trigger — 非オペレータープレイヤー入力

通常、プレイヤーは自分のスコアボードスコアを変更できない。`trigger`型のオブジェクティブは例外だ：サーバーはプレイヤーごとに`enable`でき、そのプレイヤーは`/trigger <name>`を実行してスコアを増加できる（その後自動的に無効化され、サーバーが再度有効化するまで）。

これはオペレーター権限を付与せずにプレイヤー→データパック通信を行う唯一の公式チャネルだ。ショップ、メニュー、リクエストボタン——プレイヤー入力が必要なものはすべてtriggerを通過する。

```c
@on_trigger("open_shop")
fn handle_shop() {
    give(@s, "minecraft:bread", 3);
    tell(@s, "Here's your bread.");
}
```

生成される出力：
- `load.mcfunction`：`scoreboard objectives add open_shop trigger` + `scoreboard players enable @a open_shop`
- ティックごとのチェック：`execute as @a[scores={open_shop=1..}] run function rs:__trigger_open_shop_dispatch`
- ディスパッチ：ハンドラを呼び出す → スコアをリセット → このプレイヤーに再度有効化

プログラマーは`@on_trigger`を書くだけで、コンパイラがボイラープレートを処理する。

## 完全なパイプライン

```
.rsソース
  → Lexer         (セレクタ、範囲、デコレータ、キーワード)
  → Parser        (再帰下降、優先度クライミング)
  → AST           (Program / FnDecl / Stmt / Expr)
  → Lowering      (AST → TAC IR、サブ関数抽出)
  → Optimizer     (定数畳み込み、デッドコード削除、コピー伝播)
  → Codegen       (IR → mcfunctionファイルツリー)
  → datapack/
```

191テスト、7スイート、すべてパス。

## CLI

```bash
redscript compile src/main.rs -o dist/mypack/
redscript compile src/main.rs --namespace mypack
redscript check src/main.rs      # ファイルを書かずに型チェック
redscript version
```

## 次のステップ

- `random(min, max)` → `/random value`（Java 1.21+）、`execute store result`
- `entity.tag/untag/has_tag` — `/tag`によるエンティティステートマシン
- NBTストレージでバックアップされた`struct`型
- `data modify storage ... append`による`int[]`配列
- `--target cmdblock` → 物理的なインパルス/チェーン/リピートブロックレイアウトの`.nbt`構造ファイル
- ワールドオブジェクト：クラスインスタンスとしての不可視マーカーアーマースタンド

最後の1つ——スコアボードフィールドを持つオブジェクトインスタンスとしてアーマースタンドを使用する——が最も興味のある機能だ。`let turret = spawn_object(x, y, z); turret.health -= 10;`が`execute as @e[tag=__rs_turret_0] run scoreboard players remove $health rs 10`に展開される。Minecraft内でのOOP。呪われているが避けられない。
