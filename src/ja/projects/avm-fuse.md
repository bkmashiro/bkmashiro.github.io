---
title: "AVM：AIエージェントのメモリをファイルシステムとしてマウントする"
description: "SQLiteをバックエンドとするFUSEファイルシステムを構築し、AIエージェントが標準シェルツールでメモリを読み書きできるようにした——そしてmacFUSEの癖のデバッグに1日費やした。"
date: 2026-03-06
readingTime: true
tag:
  - Python
  - AI
  - System Design
  - FUSE
outline: [2, 3]
---

AIエージェントはセッション間で全てを忘れる。標準的な解決策はエージェントが起動時に読み込む`MEMORY.md`ファイルだが、これは粗い手段だ。毎セッションでファイル全体をロードし、トークンコストは時間とともに線形に増加し、クエリする構造もない。

もっと良いものが欲しかった：エージェントメモリのための仮想ファイルシステム。`echo`でメモリを書き込み、`cat :search`でクエリし、`cat :recall`で関連コンテキストを呼び出す。全ての開発者がすでに知っているツールを使う。

## AVM：エージェント仮想メモリ

このプロジェクトは**AVM**と呼ばれる — [github.com/aivmem/avm](https://github.com/aivmem/avm)。

コアアイデア：エージェントのメモリは`/memory/private/akashi/trading/btc_lesson.md`のようなパスに配置される。SQLiteデータベースがメタデータ（重要度スコア、タグ、TTL）とともに実際のコンテンツを保存する。Python APIが構造化されたアクセスを提供する：

```python
from avm import AVM

avm = AVM()
agent = avm.agent_memory("akashi")

# メタデータとともに書き込む
agent.remember(
    "RSI > 70 on NVDA → average -12% in 5 days",
    title="nvda_rsi_rule",      # オプションのファイル名
    importance=0.9,              # 0.0–1.0、リコールランキングに影響
    tags=["trading", "nvda"]
)

# トークンバジェット制御によるリコール
context = agent.recall("NVDA risk", max_tokens=2000)
# コンパクトなマークダウンを返す：バジェット内で最も関連性の高いメモリ

# エージェント間共有：namespace=パラメータで直接共有
agent.remember(
    "Market regime: risk-off, reduce exposure",
    namespace="market"          # → /memory/shared/market/
)
```

`recall()`メソッドがキーピースだ。全てをロードする代わりに、**重要度 × 新鮮さ × 意味的関連性**で候補をスコアリングし、`max_tokens`に収まる数だけ選択し、コンパクトなサマリーを返す——生のファイルコンテンツではない。エージェントは増え続けるダンプではなく、制御されたサイズのコンテキストブロックを受け取る。

3つのスコアリング戦略が利用可能：`RECENCY`（最新優先）、`IMPORTANCE`（スコア優先）、`BALANCED`（デフォルト——意味的類似度と組み合わせた両方）。

## ベンチマーク

Mac MiniとSQLite FTS5でベンチマークを実行した：

| 操作                                         | レイテンシ      |
| -------------------------------------------- | --------------- |
| `remember()` 書き込み                        | ~0.6ms          |
| FTS5検索（116ノード）                        | **0.14ms**      |
| FTS5検索（1000ノード）                       | **0.16ms**      |
| `recall()`（トークンバジェット付き）         | **0.11–0.28ms** |
| セマンティック検索（sentence-transformers、ホット） | ~5.6ms     |

FTS5は高速でこのスケールでは実質的にO(1)だ。セマンティック検索はCPU上で著しく遅い——曖昧マッチングには有用だが、ほとんどのリコールクエリには不要だ。

## FUSEレイヤー

Python APIはクリーンだが、メモリとのやり取りにコードを書く必要があることを意味する。真の革新はFUSEファイルシステムだ：AVMを`/tmp/avm`にマウントし、標準シェルツールを使用する。

```bash
avm mount /tmp/avm --daemon

# メモリを書き込む
echo "RSI > 70 → exit" > /tmp/avm/memory/private/akashi/rsi_rule.md

# 読み返す
cat /tmp/avm/memory/private/akashi/rsi_rule.md

# 検索（仮想ノード）
cat /tmp/avm/:search?RSI

# トークンバジェット付きリコール
cat /tmp/avm/:recall?query=NVDA+risk&max_tokens=2000

# メタデータ
cat /tmp/avm/:stats
```

仮想ノード（`:search`、`:recall`、`:stats`、`:meta`、`:tags`）が巧妙な部分だ——実際のファイルではなくFUSEで読み取り可能なエンドポイントだ。`:recall?query=X`を読み取ると、完全なスコアリングと合成パイプラインが起動し、結果をファイルコンテンツとして返す。

## macFUSEのデバッグ

macOSでFUSEを動作させるのに今日のほとんどを費やした。バグの連鎖：

**問題1：FUSEが全くマウントされない。**

```
FUSE error: 1
RuntimeError: 1
No FUSE in mount table
```

`fuse_main_real()`は有用なエラーなしに1を返した。根本原因：macFUSEカーネル拡張は_システム設定 → プライバシーとセキュリティ_で明示的な承認が必要だ。拡張はインストールされていたが認可されていなかった。承認と再起動後、FUSEはマウントされた——しかし部分的だけ。

**問題2：`ls`が無期限にブロックされた。**

```
[getattr] / → OK
[getattr] /.DS_Store → ENOENT（予想通り）
ls（ブロック、戻らない）
```

`getattr`は動作していたが`readdir`は呼び出されていなかった。修正：macFUSEは`opendir`と`releasedir`メソッドの実装を必要とし、そうでなければ`readdir`は暗黙的に呼び出されない。Fusepyはこれを明確に文書化していない。2つのスタブ実装を追加すると全てが解決した：

```python
def opendir(self, path):
    return 0

def releasedir(self, path, fh):
    pass
```

**問題3：マウント状態検出が壊れていた。**

デーモンモードが動作した後、`avm status`はマウントされていても「stale」を表示した。コードはマウント状態をチェックするために`mount`を使用していたが、macOSではサブプロセスのデフォルト`$PATH`に`mount`がない——`/sbin/mount`にある。一行修正。

**問題4：`fusepy`が必須依存関係にない。**

`fusepy>=3.0`は`pyproject.toml`のオプション依存関係としてリストされていた。`pip install avm`でインストールするとスキップされ、`ModuleNotFoundError: No module named 'fuse'`が発生した。必須依存関係に移動した。

4つの修正後、フルテストスイートがクリーンに実行された：

```
:meta ✓  :tags ✓  :stats ✓  :search ✓  :recall ✓
daemon mode ✓  persistence ✓  file read/write ✓
```

## 次のステップ

議論した非同期埋め込みキュー設計：`remember()`はすぐにコンテンツを書き込み、バックグラウンドスレッドが埋め込みを生成し、`recall()`は埋め込みがまだ準備できていない場合はFTSにフォールバックする。これにより書き込みを<1msに保ちつつ、呼び出し元をブロックせずに最終的にセマンティック検索を可能にする。

テストカバレッジは今日49%（40%から上昇）。残りのギャップは`mcp_server.py`（0%）、`providers/*`（~20%）、`permissions.py`（34%）だ。

エージェントがメモリをファイルシステムのように扱うことが目標だ——それがまさにそれが何であるかだから。
