---
title: "Sandlock v1.4：単一ファイルからフルスタックサンドボックスへ"
date: 2026-03-09
readingTime: true
outline: [2, 3]
tag:
  - "システム設計"
  - "セキュリティ"
  - "C"
  - "Linux"
description: "Sandlockは822行のCファイルでseccompとrlimitsを行うところから始まった。v1.4.0で、厳格モード、言語レベルサンドボックス、ソーススキャン、完全な攻撃防御マトリックスを持つモジュラーサンドボックスになった。"
---

`sandbox_exec`がより汎用的なものに進化する過程を文書化してきた。この投稿はSandlock v1.4.0について——単なる巧みなラッパーではなく、適切なマルチレイヤーセキュリティシステムになったポイント。

**リポジトリ：** [github.com/bkmashiro/Sandlock](https://github.com/bkmashiro/Sandlock)

## リファクタリング：822行 → 8モジュール

v1.3.0の単一ファイルは822行に達し、手に負えなくなっていた。分割した：

```
src/
├── sandlock.h    (156行)  — 共有型、config構造体
├── main.c        (261行)  — CLI解析、fork/execオーケストレーション
├── config.c       (80行)  — 検証、競合検出
├── strict.c      (350行)  — seccomp notifyパスレベル制御
├── seccomp.c      (76行)  — BPFフィルタ生成
├── landlock.c    (102行)  — Landlock LSMファイルシステムルール
├── rlimits.c      (31行)  — リソース制限
├── pipes.c        (94行)  — I/Oパイプ処理
└── isolation.c   (110行)  — /tmp分離とクリーンアップ
```

最長ファイルは822行から261行になった。`make single`は単純なデプロイメントのためにモノリスをまだビルドできる。

## v1.3：ログレベル

シンプルだが必要——これ以前は、sandlock出力はオール・オア・ナッシングだった。

```bash
./sandlock              # INFO（デフォルト）
./sandlock -v           # DEBUG：「executing python3」を表示
./sandlock -vv          # TRACE：最大詳細度
./sandlock -q           # WARN：エラーと警告のみ
./sandlock -qqq         # SILENT：子出力のみ
```

テストでは、厳格モードインターセプターが何をしているかを正確に見るのに`-v`は非常に価値がある。本番では、`-q`がLambdaログをクリーンに保つ。

## v1.4：厳格モード

これが興味深いもの。既存のseccompフィルターはシステムコールレベルで機能する——「`socket()`をブロック、`read()`を許可」。脅威が許可された`openat()`を通じて`/etc/passwd`や`/proc/self/environ`を読むことである場合、それは助けにならない。

厳格モードは`seccomp notify`（カーネル5.0+、`SECCOMP_FILTER_FLAG_NEW_LISTENER`）を使用して、特定のシステムコールを完全にブロックするのではなく、親プロセスでインターセプトする。

使用法：

```bash
# /tmpアクセスのみ許可
./sandlock --strict --allow /tmp -- python3 student.py

# デバッグ：何がブロックされているかを見る
./sandlock --strict --allow /tmp -v -- python3 student.py
# sandlock: DEBUG: BLOCKED: openat(/etc/passwd)
# sandlock: DEBUG: BLOCKED: openat(/proc/self/environ)
```

フィルターは実行に必要なシステムパス（`/bin`、`/lib`、`/lib64`、`/usr/bin`、`/etc/ld.so.*`、`/dev/null`、`/dev/urandom`）を常に許可する。それ以外はすべて`--allow`しない限りデフォルトで拒否される。

## 設定競合検出

新しい`config.c`モジュールがフォーク前の起動時に設定を検証する：

| 競合                          | アクション                                     |
| ----------------------------- | ---------------------------------------------- |
| `--allow`なしの`--strict`     | エラー — 起動しない                           |
| `--strict` + `--pipe-io`      | 警告 — pipe-ioを無効化（デッドロックリスク）  |
| `--landlock` + `--strict`     | 警告 — 両方機能するが冗長                     |
| `--isolate-tmp` + `--cleanup-tmp` | 警告 — 冗長                               |
| `--cpu` > `--timeout`         | 警告 — timeoutが先にトリガー                  |

互換性のないオプションからのサイレント失敗はもうない。

## 言語レベルサンドボックス

Cコアは OSレイヤーを処理する。v1.5.0（同日リリース）はその上に言語固有のレイヤーを追加した。

### Python (`lang/python/sandbox.py`)

インポートフック + 制限されたビルトイン。危険なモジュールはインポート時にブロックされ、危険なビルトインは削除される。

**既知のバイパスベクトル：** `().__class__.__bases__[0].__subclasses__()` — イントロスペクションを通じた古典的なPythonサンドボックスエスケープ。部分的な緩和策あり；ソーススキャナーがより強固なバックストップ。

### JavaScript (`lang/javascript/`)

2つのバリアント：

- **`sandbox.js`** — Nodeの`vm`モジュールを介した厳格なVM分離、process/eval/Functionなし、モジュールホワイトリスト
- **`wrapper.js`** — npmパッケージ利用可能、`require`レベルでのランタイムパッチ

### ソースコードスキャナー (`lang/scanner/scanner.py`)

C/C++/Python/JavaScript/Rust/Goの実行前静的分析。これはコンパイルまたは実行前に実行される——インラインアセンブリでの直接システムコール試行を捕捉できる唯一のレイヤー。

### LD_PRELOADフック (`lang/preload/sandbox_preload.c`)

ソースを変更できないコンパイル済みバイナリ用：

```bash
LD_PRELOAD=./sandbox_preload.so \
  SANDBOX_NO_NETWORK=1 \
  SANDBOX_NO_FORK=1 \
  SANDBOX_ALLOW_PATH=/tmp \
  ./program
```

`socket`、`connect`、`bind`、`fork`、`execve`、`execvp`、`open`、`fopen`をフック。`LD_PRELOAD`削除を防ぐために`unsetenv`/`putenv`もブロック。

**既知のバイパス：** 静的リンク、インライン`syscall()` asm。スキャナーがこれらに対する防御。

## 完全な防御マトリックス

モジュラー設計の真の価値はレイヤーがどのように構成されるかだ。フルスタックSandlockが攻撃対象領域をどのようにカバーするか：

| 攻撃               | seccomp | Landlock/Strict | 言語サンドボックス | スキャナー | 結果      |
| ------------------ | :-----: | :-------------: | :---------------: | :-------: | --------- |
| ネットワーク漏洩   |   ✅    |        —        |        ✅         |    —      | 🔴 ブロック |
| リバースシェル     |   ✅    |        —        |        ✅         |    —      | 🔴 ブロック |
| Fork爆弾           |   ✅    |        —        |        ✅         |    —      | 🔴 ブロック |
| /etc/passwd読み取り |    —    |       ✅        |        ✅         |    —      | 🔴 ブロック |
| /tmp外への書き込み  |    —    |       ✅        |        ✅         |    —      | 🔴 ブロック |
| ptrace             |   ✅    |        —        |        —          |    —      | 🔴 ブロック |
| インラインasmシステムコール |   ✅    |        —        |        —          |   ✅      | 🔴 ブロック |
| dlopen/FFI         |   ✅    |        —        |        ✅         |   ✅      | 🔴 ブロック |
| 直接システムコール(asm) |   ✅    |        —        |        ⚠️         |   ✅      | 🟡 困難   |
| /proc情報漏洩      |    —    |       ⚠️        |        ⚠️         |    —      | 🟡 部分的 |

残りのギャップ——`/proc`情報漏洩、カーネル0-day——はそれぞれマウント名前空間とOSレベルの更新が必要。どちらも純粋なユーザー空間では解決できない。

## カーネル互換性

| 機能           | 最小カーネル | AWS Lambda (5.10) | モダン (6.x) |
| -------------- | :----------: | :---------------: | :----------: |
| seccomp-bpf    |     3.5      |        ✅         |      ✅      |
| seccomp notify |     5.0      |        ✅         |      ✅      |
| Landlock       |    5.13      |        ❌         |      ✅      |

LambdaはFirecracker経由でカーネル5.10を実行する——Landlockは利用できず、Firecrackerは追加のものをインストールするのをブロックする独自のseccompフィルターを適用する。Lambdaでは、防御スタックは：rlimits + 言語サンドボックス + LD_PRELOAD + ソーススキャナー + 環境クリーンアップ + VPCエグレスルール。

## パフォーマンス

| 設定                          | オーバーヘッド |
| ----------------------------- | -------------- |
| 最小（seccomp + rlimits）     | 約1.5ms        |
| フル（すべてのオプション）    | 約2.5ms        |
| 厳格モード（インターセプトされたシステムコールごと） | 約0.1ms  |
| Pythonサンドボックスオーバーヘッド | 約8ms       |

8msのPythonサンドボックスオーバーヘッドはすべてのインポートでモジュール名をスキャンするインポートフック。保護に対して価値があるが、知っておく価値がある。
