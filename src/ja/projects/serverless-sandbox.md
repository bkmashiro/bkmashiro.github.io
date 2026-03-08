---
title: "サーバーレスにおける学生コードのサンドボックス化：脅威モデル"
description: "AWS LambdaがAWSインスタンスを学生間で再利用するとどうなるか？攻撃面をマッピングし、サンドボックスオプションを比較し、巧妙な回避策を見つけた——rootアクセスなしで。"
date: 2026-03-07
readingTime: true
tag:
  - Systems
  - Security
  - Serverless
  - WebAssembly
outline: [2, 3]
---

今日、私の修士プロジェクトが正式に始動した。前提は単純に聞こえる：AWS Lambda内で学生のコードを安全に実行する。制約がそれを興味深くする。

## 問題

[Lambda Feedback](https://github.com/lambda-feedback/shimmy)は学生がコードを提出してリアルタイムで評価される基盤だ。バックエンドはサーバーレス関数を使用する——AWS Lambdaがコンテナを起動し、コードを実行し、結果を返す。

パフォーマンスのため、Lambdaはコンテナを_再利用_する。5分前に学生Aの提出を処理した関数が学生Bの次の処理をするかもしれない。同じファイルシステム、同じプロセスメモリ、同じ`/tmp`。

これは問題だ。

```
[Lambda Instance]
├── /tmp          ← 書き込み可能、呼び出し間で永続
├── env vars      ← シークレットを含む可能性
├── process memory ← Pythonモジュールのグローバルはウォームスタートで生存
└── network       ← デフォルトでアウトバウンドは開いている
```

学生Aが`/tmp`にファイルを書き込める。学生Bがそれを読める。最悪の場合、学生Aが評価者のロジックを外部流出させたり、採点環境を汚染したりできる。

## できないこと

標準的なOSレベルの分離は不可能だ：

- **rootなし** → ユーザー名前空間なし、`unshare`なし、`nsjail`なし
- **KVMなし** → Firecrackerなし、マイクロVMなし
- **FUSEなし**（おそらく）→ プロセスレベルのオーバーレイファイルシステムなし
- **CAP_BPFなし** → eBPFベースのsyscallフィルタリングは不可（arXiv 2302.10366によると攻撃面を~55%削減できるが）

Lambdaはすでに独自の`seccomp-bpf`フィルターを適用している。その上に重ねることはできるが、下には行けない。注目すべきは：Lambda自体はFirecracker MicroVM_内で_実行される——外側の分離は存在するが、同じLambdaインスタンス内の学生の呼び出し間で_内側の_分離が必要だ。Firecrackerのjailerデザイン（seccomp + 名前空間 + ファイルシステム分離）は直接複製できなくても参考になる。

実際にはまだわからないことがある：Lambdaインスタンスは_新しい_seccompフィルターをロードできるか、それともユーザーコードが実行される時点でフィルターはすでにロックされているか？それは実験的なもの——プローブスクリプトをデプロイして確認する必要がある。

## 防御マトリックス

利用可能なものと各ツールがカバーするもの：

| 攻撃          | seccomp | rlimit | env cleanup | /tmp clear |
| ------------- | ------- | ------ | ----------- | ---------- |
| フォーク爆弾  | ✅      | ✅     | —           | —          |
| メモリ爆弾    | —       | ✅     | —           | —          |
| ディスク爆弾  | —       | ✅     | —           | ✅         |
| /tmp盗み見    | —       | —      | —           | ✅         |
| env var漏洩   | ⚠️      | —      | ✅          | —          |
| /proc読み取り | ⚠️      | —      | —           | —          |
| リバースシェル| ✅      | —      | —           | —          |
| ネットワーク流出| ✅    | —      | —           | —          |
| setuid        | ✅      | —      | —           | —          |

ギャップ：`/proc`読み取りと環境変数漏洩。`seccomp`は`getenv()`をブロックできない——それはsyscallではなくメモリ読み取りだ。BPF引数検査による`/proc`フィルタリングは脆弱だ。

**90%のカバレッジは達成可能。残りの10%は創意工夫が必要だ。**

## 巧妙な回避策

### 1. `LD_PRELOAD`インターセプト

カーネルアクセスは不要。`open()`をラップするシムをコンパイルする：

```c
// libcレベルでファイルオープンをインターセプト
int open(const char *path, int flags, ...) {
    if (strstr(path, "/proc") || strstr(path, "/var/task"))
        return -EACCES;
    return real_open(path, flags, ...);
}
```

```bash
LD_PRELOAD=/lib/shimmy_sandbox.so python3 student_submission.py
```

学生コードが`open("/proc/self/environ")`を呼ぶ → 拒否される。カーネルの変更なし。`LD_PRELOAD`が除去されない場所ならどこでも動作する。

欠点：これを知っている断固とした学生は回避できる（直接`syscall()`を呼ぶ）。これは多層防御で、ハードバウンダリではない。

### 2. 環境変数のサニタイズ

env var漏洩の最も単純な修正：

```python
clean_env = {
    "PATH": "/usr/bin:/usr/local/bin",
    "HOME": "/tmp/student",
    "LANG": "en_US.UTF-8",
    # 他は全て除去 — AWS_*なし、シークレットなし
}
subprocess.run(["python3", "submission.py"], env=clean_env)
```

オーバーヘッドゼロ。どのアプローチにも対してもベースラインであるべきだ。

### 3. WebAssembly（最終手段）

WASmランタイム内で学生コードを実行する。PyodideはCPythonをWASMにコンパイルする；Wasmer/Wasmtimeがホストを提供する。

```
student code → Pyodide → WASM linear memory → Wasmtime
                                              ↑
                                    syscallなし。ファイルシステムなし。
                                    全てがホストインポートを通る。
```

これは全てを解決する——`/proc`、env vars、ネットワーク、全部。WASMインスタンスはホストファイルシステムの概念を持たない。

コスト：Pyodideは~30MBとスタートアップに数秒を追加する。高速フィードバックを重視するプラットフォームでは、これは現実だ。しかしギャップを全て閉じる唯一のオプションだ。

## 推奨スタック

今のところ：**fork + seccomp + rlimit + env sanitization**。

```
Lambda呼び出し
  └── fork()で新しいプロセス
        ├── seccomp-bpfフィルターを適用（危険なsyscallを拒否）
        ├── rlimitを適用（CPU、メモリ、オープンファイル）
        ├── envをクリーン（AWS_*を除去、PATH/HOME/LANGのみ保持）
        ├── /tmpをクリア
        └── 学生コードを実行
```

これはrootなし、低複雑度、合理的なパフォーマンスオーバーヘッドで脅威面の~90%をカバーする。

WASMはツールチェーンがサポートする言語の長期パスとしてロードマップに入る。Pythonが優先度——Pyodideは十分に本番対応している。

## shimmy統合ポイント

何にも手をつける前に、[shimmy](https://github.com/lambda-feedback/shimmy)をマッピングした——Lambda Feedbackの評価関数を管理するGoシムだ。現在の状態：全くサンドボックス化がない。ワーカーライフサイクル（スポーン → 評価 → 応答 → アイドル）が追加する分離の自然な統合ポイントだ。

fork-per-invocationアプローチはここにクリーンに収まる：shimmyはすでにワーカープロセスを管理している。呼び出しパスにフックして、子でfork、seccompとrlimitを適用、学生コードを実行し、プロセスを廃棄する。

## 未解決の問題

脅威モデルは明確だ；いくつかの実装上の問題はそうでない：

1. **Lambda内で新しいseccompフィルターをロードできるか？** Lambdaの既存フィルターはすでに`SECCOMP_FILTER_FLAG_TSYNC`でロックされているかもしれない。実験的なテストだけが教えてくれる。
2. **`fork()`にレート制限があるか？** Lambdaはプロセス生成をスロットリングするかもしれない。そうなら、真のfork-per-invocationではなくリセット付きのワーカープールが必要だ。
3. **`prctl()`が役立つか？** `PR_SET_NO_NEW_PRIVS`はrootなしでほぼ確実に適用できる低コストのハードニングステップだ。
4. **PyodideはLambdaのメモリ制限に対応できるか？** Pyodideはプロセスに~30MBを追加する。Lambdaのデフォルトは128MB。ギリギリだ。

## 次のステップ

- 実際のLambdaにプローブスクリプトをデプロイ：実際に利用可能なsyscall、ケイパビリティ、カーネル機能をマッピングする
- 論文を読む：[Firecracker (NSDI'20)](https://www.usenix.org/system/files/nsdi20-paper-agache.pdf)、syscall interpositionサーベイ（[arXiv 2302.10366](https://arxiv.org/abs/2302.10366)）
- shimmyの呼び出しパス内で`fork() + seccomp + rlimit`をプロトタイプ化
- オーバーヘッド（分離コスト）対セキュリティゲインをベンチマーク
- 2週間後に指導教員との面談

ここでの興味深い制約——ユーザースペースのみ、OSの変更なし——が創造的な解決策を強制する。それがこれを設定問題ではなく研究プロジェクトにするものだ。
