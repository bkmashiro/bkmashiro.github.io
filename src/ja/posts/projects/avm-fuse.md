---
title: "AVM：AIエージェントのメモリをファイルシステムとしてマウントする"
description: "SQLiteをバックエンドにしたFUSEファイルシステムを構築し、AIエージェントが標準のシェルツールでメモリを読み書きできるようにした。そして一日かけてmacFUSEの癖をデバッグした話。"
date: 2026-03-06
readingTime: true
tag:
  - Python
  - AI
  - システム設計
  - FUSE
outline: [2, 3]
---

AIエージェントはセッションをまたいですべてを忘れる。標準的な解決策はエージェントが起動時に`MEMORY.md`ファイルを読むことだが、これは鈍い道具だ。すべてのセッションでファイル全体を読み込み、トークンコストは時間とともに線形に増大し、クエリ可能な構造もない。

より良いものが欲しかった：エージェントメモリ用の仮想ファイルシステム。`echo`でメモリを書き込み、`cat :search`でクエリし、`cat :recall`で関連コンテキストを呼び起こす。すべての開発者がすでに知っているツールを使って。

## AVM：エージェント仮想メモリ

このプロジェクトは**AVM**と呼ばれる — [github.com/aivmem/avm](https://github.com/aivmem/avm)。

核心的なアイデア：エージェントメモリは`/memory/private/akashi/trading/btc_lesson.md`のようなパスに存在する。SQLiteデータベースが実際のコンテンツとメタデータ（重要度スコア、タグ、TTL）を保存する。Python APIが構造化アクセスを提供する：

```python
from avm import AVM

avm = AVM()
agent = avm.agent_memory("akashi")

# メタデータ付きで書き込む
agent.remember(
    "RSI > 70 on NVDA → 5日間で平均 -12%",
    title="nvda_rsi_rule",      # オプションのファイル名
    importance=0.9,              # 0.0–1.0、リコールランキングに影響
    tags=["trading", "nvda"]
)

# トークンバジェット制御のリコール
context = agent.recall("NVDAリスク", max_tokens=2000)
# コンパクトなMarkdownを返す：バジェット内の最も関連性の高いメモリ

# クロスエージェント共有：namespace=パラメータで直接共有
agent.remember(
    "市場レジーム：リスクオフ、エクスポージャー削減",
    namespace="market"          # → /memory/shared/market/
)
```

`recall()`メソッドが重要なピースだ。すべてを読み込む代わりに、候補を**重要度 × 鮮度 × 意味的関連性**でスコアリングし、`max_tokens`内に収まるだけ選択し、コンパクトなサマリーを返す——生のファイルコンテンツではなく。エージェントは制御されたサイズのコンテキストブロックを受け取る。

三つのスコアリング戦略が利用可能だ：`RECENCY`（最新優先）、`IMPORTANCE`（スコア優先）、`BALANCED`（デフォルト——両方と意味的類似度を組み合わせる）。

## ベンチマーク

SQLite FTS5を使用してMac Mini上でベンチマークを実行した：

| 操作 | レイテンシ |
|------|-----------|
| `remember()` 書き込み | ~0.6ms |
| FTS5検索（116ノード）| **0.14ms** |
| FTS5検索（1000ノード）| **0.16ms** |
| `recall()` トークンバジェット付き | **0.11–0.28ms** |
| セマンティック検索（sentence-transformers、ウォーム）| ~5.6ms |

FTS5は速く、このスケールでは本質的にO(1)だ。セマンティック検索はCPU上では大幅に遅い——ファジーマッチングには有用だが、ほとんどのリコールクエリには必要ない。

## FUSEレイヤー

Python APIはクリーンだが、メモリと対話するためにコードを書く必要があることを意味する。本当のアンロックはFUSEファイルシステムだ：AVMを`/tmp/avm`にマウントし、標準のシェルツールを使う。

```bash
avm mount /tmp/avm --daemon

# メモリを書き込む
echo "RSI > 70 → 退場" > /tmp/avm/memory/private/akashi/rsi_rule.md

# 読み返す
cat /tmp/avm/memory/private/akashi/rsi_rule.md

# 検索（仮想ノード）
cat /tmp/avm/:search?RSI

# トークンバジェットリコール
cat /tmp/avm/:recall?query=NVDAリスク&max_tokens=2000

# メタデータ
cat /tmp/avm/:stats
```

仮想ノード（`:search`、`:recall`、`:stats`、`:meta`、`:tags`）が巧妙な部分だ——実際のファイルではなく、FUSE可読なエンドポイントだ。`:recall?query=X`を読み取ると、完全なスコアリングと統合パイプラインがトリガーされ、結果がファイルコンテンツとして返される。

## macFUSEのデバッグ

macOSでFUSEを動かすのに今日の大半を費やした。バグの連鎖：

**問題1：FUSEがまったくマウントできない。**

```
FUSE error: 1
RuntimeError: 1
No FUSE in mount table
```

`fuse_main_real()`が1を返し、有用なエラーがない。根本原因：macFUSEカーネル拡張は_システム設定 → プライバシーとセキュリティ_で明示的に承認が必要だ。拡張はインストールされていたが、承認されていなかった。承認と再起動後、FUSEはマウントした——しかし部分的にしか。

**問題2：`ls`が無限にブロックする。**

```
[getattr] / → OK
[getattr] /.DS_Store → ENOENT（期待通り）
ls（ブロック、返ってこない）
```

`getattr`は動いていたが、`readdir`は呼ばれなかった。修正：macFUSEは`opendir`と`releasedir`メソッドの実装を必要とし、そうでなければ`readdir`は静かに呼ばれない。fusepyはこれを明確に文書化していない。2つのスタブ実装を追加してすべてが解決した：

```python
def opendir(self, path):
    return 0

def releasedir(self, path, fh):
    pass
```

**問題3：マウント状態の検出が壊れていた。**

デーモンモードが動いた後、`avm status`はマウントされていても「stale」を表示した。コードはマウント状態を確認するために`mount`を使っていたが、macOSでは`mount`はサブプロセスのデフォルト`$PATH`にない——`/sbin/mount`にある。一行の修正。

**問題4：`fusepy`が必須依存関係に含まれていなかった。**

`fusepy>=3.0`は`pyproject.toml`でオプション依存関係としてリストされていた。`pip install avm`でインストールするとスキップされ、`ModuleNotFoundError: No module named 'fuse'`が発生する。必須依存関係に移動した。

4つの修正後、完全なテストスイートがクリーンに通過した：

```
:meta ✓  :tags ✓  :stats ✓  :search ✓  :recall ✓
デーモンモード ✓  永続化 ✓  ファイル読み書き ✓
```

## 次のステップ

議論した非同期エンベディングキューの設計：`remember()`はコンテンツをすぐに書き込み、バックグラウンドスレッドがエンベディングを生成し、`recall()`はエンベディングがまだ準備できていない場合はFTSにフォールバックする。これにより書き込みを<1msに保ちながら、最終的には呼び出し元をブロックしないセマンティック検索を実現できる。

テストカバレッジは今日49%（40%から上昇）。残りのギャップは`mcp_server.py`（0%）、`providers/*`（~20%）、`permissions.py`（34%）にある。

エージェントがメモリをファイルシステムのように扱えるようにすること——実際にそうであるように——それが目標だ。
