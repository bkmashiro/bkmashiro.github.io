---
title: "学生コード用ユーザー空間サンドボックスの構築：3時間のレッドチーミング"
description: "seccomp-bpfとrlimitsを使用して224行のCサンドボックスを構築し、3時間かけて破ろうとした。発見したことはこれだ。"
date: 2026-03-09
readingTime: true
tag:
  - システム設計
  - セキュリティ
  - C
  - サーバーレス
outline: [2, 3]
---

**更新 2026-03-09：** `sandbox_exec`はその後**Sandlock**に進化した——厳格モード、言語レベルサンドボックス（Python/JS）、ソーススキャナー、LD_PRELOADフックを持つモジュラーなフルスタックサンドボックス。[Sandlock v1.4：単一ファイルからフルスタックサンドボックスへ](/ja/projects/sandlock-v14)と[GitHubリポジトリ](https://github.com/bkmashiro/Sandlock)を参照。

---

先週、AWS Lambdaで学生コードを実行するための[脅威モデル](/posts/projects/serverless-sandbox)について書いた。今週はそれを構築して破ろうとした。

結果：`sandbox_exec`、学生の提出をseccomp-bpfフィルターでラップし、リソース制限を強制し、5ラウンドのレッドチームの試練に合格した224行のCプログラム。

## なぜWASMや名前空間ではないのか

コードを書く前に3つのアプローチを評価した：

| アプローチ              | 分離      | レイテンシ | ユーザー空間 | Lambda | Python?     |
| ----------------------- | --------- | ---------- | :----------: | :----: | ----------- |
| **seccomp（ユーザー空間）** | プロセス | 約1.5ms    | ✅           | ⚠️     | ✅ フル     |
| 名前空間（root）        | コンテナ  | 約5ms      | ❌           | ❌     | ✅ フル     |
| WebAssembly（Pyodide）  | VM        | 約10-50ms  | ✅           | ✅     | ⚠️ 限定的  |

> **Lambdaに関する注記：** seccomp-bpfは⚠️マーク——カーネルレベルで存在するが、Firecrackerは**ユーザーが追加のフィルターをインストールするのをブロックする**独自のseccompフィルターを適用する。`sandbox_exec`は完全なユーザー空間Linux（Docker、VM、ベアメタル）でそのまま動作する。Lambdaでは、防御スタックはrlimits + 環境クリーンアップ + 言語レベルサンドボックスにシフトする。

Lambdaはrootもないしも KVMもない。名前空間は使えない。WebAssemblyのPyodide起動オーバーヘッドは本物で、C拡張（numpy、scipy）はWASMにきれいにコンパイルできない。

seccompパスは**ユーザー空間で**勝つ：高速、rootless、完全なPythonサポート。Lambda固有には、ベースラインとしてrlimitベースのリソース制御にまだ貢献する。

## sandbox_execが行うこと

コアはCのfork-execラッパーだ。学生プロセスを`exec`する前に：

1. `PR_SET_NO_NEW_PRIVS`を設定 — 子プロセスは親より多くの特権を決して得られない
2. コアダンプを無効化 — グレーダー内部を漏洩する可能性のあるメモリスナップショットなし
3. `setpgid`/`setsid`を呼び出す — プロセスグループ分離で`kill(-1)`が他のLambdaプロセスに到達できない
4. rlimitsを適用（CPU：5秒、メモリ：256MB、ファイルサイズ：10MB、FD：100、プロセス：10）
5. seccomp-bpfフィルターをロード
6. `exec`を呼び出す — フィルターがロックされ、変更不可

seccompフィルターは62のシステムコールカテゴリをブロックする：

```
ネットワーク： socket, connect, bind, listen, accept, sendto/recvfrom, socketpair
プロセス：    ptrace, process_vm_readv/writev, clone(THREADフラグなし)
カーネル：    io_uring_*, bpf, userfaultfd, perf_event_open
ファイルシステム： mount, umount2, symlink, link, chroot, pivot_root
システム：    reboot, kexec_*, *module, acct, swap*, set*name
ハードウェア： ioperm, iopl, modify_ldt
```

デフォルトアクションは`SECCOMP_RET_KILL_PROCESS` — スレッドだけでなく、プロセス全体。

## 5ラウンドのレッドチーミング

テストを書くところで止まらなかった。サンドボックス自体に対して5ラウンドのアクティブな敵対的テストを実行し、見つけたものをパッチした。

**ラウンド1：** 親プロセスへの`ptrace`。学生はLambdaワーカーにアタッチしてメモリを読むことができた——期待される答えを含めて。修正：`ptrace`をブロック。

**ラウンド2：** 2つの脆弱性。TOCTOUシンボリックリンク競合（ファイルを作成し、グレーダーが読む前にシンボリックリンクに置き換え）→ `symlink`をブロック。`inotify`監視（グレーダーが期待出力を書くのを監視）→ `inotify_*`と`fanotify_*`をブロック。

**ラウンド3：** `personality(READ_IMPLIES_EXEC)` — すべての読み取り可能なページを実行可能としてマークするビットを反転、シェルコードを容易にする。修正：`personality`をブロック。

**ラウンド4：** pid=-1での`kill`はセッション内のすべてのプロセスにSIGKILLを送信。修正：プロセス自身のpgidへの`kill`を制限。

**ラウンド5：** 新しいものは見つからず。

**最終スコア：** 60の脅威テスト、100%パス率、呼び出しごとに約1.5msのオーバーヘッド。

## 受け入れるギャップ

rootなしのユーザー空間ではすべてが解決できるわけではない。

**`/proc`漏洩：** 学生コードは`/proc/self/maps`、`/proc/1/environ`、`/proc/net/tcp`を読める。これを適切に閉じるにはマウント名前空間が必要。`--clean-env`（exec前に`AWS_*`などのシークレットを除去）で緩和し、既知の制限として文書化。

**`/dev/shm`永続化：** 共有メモリはLambda呼び出し間で永続化できる。shimmyオーケストレーションレイヤーで修正——サンドボックス自体ではなく——各評価前のクリーンアップステップで。

**NPROCアカウンティング：** Linuxはプロセスをコンテナごとではなくユーザーごとにカウント。`RLIMIT_NPROC`に達するフォーク爆弾は他のLambdaワーカーをブロックする可能性がある。最外部の境界にはLambdaのコンテナレベルの分離に頼っている。

## テストしなかったもの（そしてなぜそれでよいか）

テストできなかったリスクのカテゴリがある：カーネル0-day、投機的実行攻撃（Spectre/Meltdown）、未知のシステムコール相互作用。

我々の正直な答え：それらは存在し、受け入れる。脅威モデルは学生の宿題グレーダーであり、銀行ではない。Lambda カーネル0-dayを発見して悪用するコストは、誰かの自動グレーダーの期待出力を盗む価値より桁違いに高い。

我々が扱っているセキュリティ方程式：

```
リスク = 脅威 × 脆弱性 × 影響

脅威：       恨みを持つ学生（低い動機）
脆弱性：     最小化（5層の防御）
影響：       宿題の成績（低い価値）
```

レッドチーミングセッションからの関連する引用：_「これができる人々は宿題グレーダーを攻撃しない。」_

## 統合

サンドボックスは既存の`exec.Command`の薄いラッパーとしてshimmyにドロップインする：

```go
// internal/execution/worker/worker_unix.go
cmd := exec.Command("sandbox_exec",
    "--no-fork", "--no-network", "--clean-env",
    "--cpu", "5", "--mem", "256",
    "--", "python3", studentCode)
```

加えて各呼び出し前のクリーンアップステップ：

```bash
rm -rf /tmp/* /var/tmp/* /dev/shm/*
```

## 次のステップ

このフェーズは完了した。`sandbox_exec`は完全なユーザー空間Linux環境で堅固な保護を提供する。Lambda状況はより複雑だった——Firecrackerのseccompレイヤーはユーザーが独自のフィルターをスタックするのを防ぐので、seccompはLambdaでは事実上利用できない。オープン項目は：

- **Lambda実環境テスト** — これらすべてはDockerシミュレーションだった；Lambdaで実際にどの保護が機能するか検証が必要（rlimits ✅、seccomp ❌）
- **shimmy PR** — CコードとGo統合を上流に
- **WebAssembly研究** — WASMは制限として始まるが、「C拡張なし」の制約が問題にならない言語（純粋なPythonスクリプト、JS）では興味深くなる

WASMパスは探索する価値がある。なぜなら`/proc`と環境漏洩のギャップを完全に閉じるからだ——Pyodide起動時間と制限されたライブラリサポートのコストで。特定のワークロードではそのトレードオフは許容可能かもしれない。
