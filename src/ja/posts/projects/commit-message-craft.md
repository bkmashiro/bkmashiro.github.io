---
date: 2026-04-15
description: "良いコミットメッセージとは何か。実際のコミット履歴のパターン、よくあるアンチパターン、そして未来の自分に感謝される書き方の哲学。"
title: "コミットメッセージの技芸：git logはあなたについて何を語るか"
readingTime: true
tag:
  - Git
  - Dev Tools
  - Software Engineering
outline: [2, 3]
---

同じ変更に対する2つのコミットメッセージを見てほしい——テストスイートのレースコンディション修正だ：

```
Fixed wait condition in test worker kill process
```

```
fix: replace sleep-based sync with process.Wait() in worker kill test
```

最初のメッセージは「何かが変わった」と伝える。2番目は*何が*問題で、*何で*置き換えられ、*どこで*それが起きたかを伝える。6ヶ月後、`git bisect` がこのコミットに降り立ったとき、どちらかのメッセージは20分を節約してくれる。もう一方はdiffを読ませることになる。

自分が作業・管理した約15のリポジトリのコミット履歴を調べてみた——小さなCLIツールから数百コミットを持つフルスタックアプリまで——そして見つけたものをカテゴライズした。パターンは一貫していて、書く価値があると思う。

## なぜコミットメッセージが重要か（考古学の論拠）

コミットログはコードベースの考古学的な地層だ。混乱している行で `git blame` を実行してコミットメッセージが「update」だったとき、何も分からない。「fix: MIR lowering で未解決識別子に対してゼロへのサイレントフォールバック」が見つかったとき、意図がすぐに分かり、現在のコードがまだその目的を果たしているかを判断できる。

コミットメッセージを重要にする3つのツール：

- **`git blame`** — 「この行はなぜ存在するのか？」 コミットメッセージが答えてくれる場合にのみ有用。
- **`git bisect`** — バグを導入したコミットのバイナリサーチ。良いメッセージは明らかに無関係なコミットを一目でスキップさせてくれる。
- **`git log --oneline`** — 誰も管理しなくていいchangelog。メッセージが良ければ、これ*が*changelogだ。

コミットメッセージの読者は、今日PRを承認するレビュワーではない。6ヶ月後の午前2時に本番障害をデバッグしている開発者（ひょっとしたら自分）だ。

## アンチパターン動物園

実際に見つけたパターンを、ダメージの大きさ順に整理する。

### 一語の虚無

```
logging
logging cleanup
debugging
proc
fix adapter
```

これは実際のリポジトリからのものだ。5つの連続するコミット、ログは何が変わったか、なぜ変わったかについて何も教えてくれない。「logging cleanup」——どのlogging？何が汚かったのか？「proc」——プロセスについて何？「debugging」——デバッグコードをコミットしたのか？それともデバッグしていたバグを修正したのか？

修正は単純だ：10秒使う。「Remove verbose stdout logging from worker lifecycle」は書くのに10秒、後で理解するのに10分節約できる。

### 目的語なし動詞

```
update readme
use tmp subfolder
fix file adapter
```

「Update readme」は世界で最も一般的なコミットメッセージで、最も情報量が少ない。readmeの*何を*更新したのか？「Add installation instructions to README」はメッセージだ。「update readme」は肩をすくめているだけだ。

「Fix file adapter」——どのfile adapter？何が壊れていたのか？別のリポジトリのメッセージと比べてみよう：「fix: silent TOML config parse failures to surface errors to users」。同じ単語数で、はるかに多くの情報だ。

### 繰り返しハンマリング

あるリポジトリにこんな連続があった：

```
Fixed wait condition in test worker kill process
Fixed wait condition in test worker kill process
Fixed wait condition in test worker kill process
Fixed wait condition in test worker kill process
Fixed wait condition in test worker cancel
```

4つの同一メッセージに続いて、わずかなバリアント。これは「今回こそうまくいくかも」パターンだ——問題を理解する前に修正の試みを一つずつpushしていく。各コミットは解決策ではなく、推測だ。

これはメッセージの問題ではなく、ワークフローの問題だ。これは一つのコミットであるべきだった：「fix: race condition in worker termination tests — replace polling with synchronous Wait()」。修正を繰り返しているなら、`git commit --amend` を使うか、マージ前にsquashする。

### 過去形の罠

```
Implemented healthcheck command
Implemented preview unit tests from BaseEvalFnLayer
Refactored eval only aspects to own function
Created unit test for single feedback case
Wrote test to confirm that exceptions are caught as warnings
```

これらは文法的に正しく、そこそこ説明的だ——「update」や「fix」よりずっと良い。でも命令形が期待されるところで過去形を使っている。標準（Linuxカーネルが確立し、Conventional Commits、Angular、ほとんどの主要なオープンソースプロジェクトが採用している）は命令形だ：「Add healthcheck command」であって「Added healthcheck command」ではない。

なぜか？コミットメッセージは「このコミットを適用すると、___する」という文を完成させるべきだからだ。「このコミットを適用すると、*add healthcheck command*する」は自然に読める。「このコミットを適用すると、*implemented healthcheck command*する」はそうではない。

これが最重要なのか？いや。でも無料だし、ログの一貫性は重要だ。

## 規約が助けになるとき

私が調べた中で最もよく管理されたリポジトリは一貫したプレフィックス規約を使っていた：

```
feat: add lens expressions, pattern classifier, and path pinning
fix: correct AI-generated test expectations to match implementation
perf: delta compression + ring buffer storage (no silent drops)
design: fix hardcoded color literals — use design tokens throughout
i18n: tamper detection strings EN/ZH/JP
```

プレフィックス（`feat`、`fix`、`perf`、`design`、`i18n`）でログを速くスキャンできる。何が壊れたかを探してる？`fix:` をスキャン。このリリースで何が出荷されたか？`feat:` をスキャン。セキュリティの変更をレビューしたい？認証コード付近の `fix:` を検索。

別のリポジトリはカスタム規約を使っていた——チケットIDサフィックスを持つ `burn(type):` ：

```
burn(bug): Fix ne/inequality operator in cmpToMC() for if-score contexts [9GH3DD]
burn(test): Add tests for break/continue label error paths in MIR lowering [D628K0]
burn(docs): Add JSDoc to flattenExecute() and emit() helper functions [HB6X9N]
```

チケットID（`[9GH3DD]`）が各コミットをトラッキングシステムに繋ぐ。カテゴリ（`bug`、`test`、`docs`）でログがスキャン可能になる。標準的なConventional Commitsより冗長だが、*一貫している*から機能する。

### 規約がやり過ぎなとき

3つのコミットを持つ個人プロジェクトに対しては：

```
Initial implementation of Tempo: adaptive rate limiter with rhythm detection
Add .gitignore and remove cached/generated files from tracking
Remove cached/generated files from git tracking
```

`feat:` プレフィックスは誰も必要としない。メッセージは明確で説明的で、ストーリーを伝えている。プレフィックスはログに何百もエントリがあってフィルタが必要なときに価値を発揮する。5つのコミットしかないリポジトリでは形式的なだけだ。

## 時間に耐えたメッセージ

見つけた最良のメッセージは共通のパターンを持つ：*解決策*ではなく*問題*を説明している。

```
fix: per-cardKey phase map so leaving card holds answer state during slide
```

これは単に「card stateを修正」とは言っていない——メカニズム（per-cardKey phase map）と症状（カードを離れるとスライドアニメーション中に回答状態が失われた）を伝えている。1年後、誰かがカードアニメーションコードを触るとき、このメッセージは警告サインだ：「phase mapには理由がある、気をつけて」。

```
feat: detect pre-git timestamp tampering (<2005-04-07); block leaderboard enrollment + show roast banner
```

件名としてはほぼ詳細すぎるが、検出の閾値、結果、ユーザへの影響が詰まっている。diffを読まなくても、コミットメッセージだけでフィーチャ全体を理解できる。

比べてみよう：

```
fix adapter
```

どちらが2028年に意味を持つか。もう一方はすでに意味を持っていない。

## ヒューリスティック

コミットメッセージでEnterを押す前に、このテストを適用してほしい：

**このファイルの `git log --oneline` だけを読んだ人は、なぜこの変更が存在するのかを理解できるか？**

*何が*変わったかではない——それはdiffが示す。*なぜ*変わったか。何が壊れていたか、何が足りなかったか、ゴールは何だったか。

二次的なテスト：**`git bisect` はこのメッセージから恩恵を受けるか？** リグレッションを二分探索してこのコミットに着地したとき、5秒で関連があるかどうか分かるか？

両方にyesなら、メッセージは十分に良い。そうでなければ、足りない一文を加えよう——たいていは「なぜなら」または「そうすることで」の部分だ。

## ルールを破っていいとき

ルールはメインの履歴のために存在する。どこにでも適用されるわけではない：

- **マージ前にsquashするフィーチャブランチのWIPコミット**：好きに書いていい。「WIP stuff」が `main` に届かなければそれで良い。
- **自動化されたコミット**：`chore: auto-bump vscode extension to 1.3.93 [skip ci]` は機械的で、機械的に見えるべきだ。着飾らなくていい。
- **初回コミット**：`Initial implementation of Strata: Environment Archaeology Tool` は完璧に良い。プレフィックス不要。プロジェクト履歴の最初の文を書いている——意味のある文にしよう。
- **リバートコミット**：gitがメッセージを生成してくれる。そのままにしよう。

目標はルールに従うことではない。目標は `git log` がストーリーを語ること——未来の開発者が読み、検索し、信頼できるものを。すべてのコミットメッセージはドキュメンテーションの小さな行為だ。ほとんどは読まれない。読まれるものは最悪のタイミングで読まれる：障害中、bisect中、「誰がこれを書いたんだ、なぜ」と思う真夜中の瞬間に。

10秒使おう。読者は未来の自分で、「fix adapter」が何を意味したか覚えていない。
