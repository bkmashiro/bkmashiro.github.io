---
title: "手作りキューからBullへ：ジャッジパイプラインの再設計"
description: "オリジナルのLeverage OJには静かにジョブをドロップするカスタムRedisキューがあった。ジャッジパイプラインの再設計——何が変わったか、なぜ、そして慎重に考える必要があったat-least-once配信問題。"
date: 2026-03-08
readingTime: true
tag:
  - システム設計
  - Redis
  - キュー
  - NestJS
  - OJ
outline: [2, 3]
---

提出パイプラインはOnline Judgeのクリティカルパスだ。学生がコードを提出し、それがキューに入り、ワーカーが取り上げ、ジャッジに送信し、結果を待ち、書き戻す。理論上はシンプル。オリジナルのLeverage実装はRedis Listsで構築されたカスタムキューだった——そしてものが横道にそれたときにのみ現れる問題があった。

この投稿はなぜそれを置き換えたか、置き換えがどのように見えるか、そしてメッセージ配信について慎重に考えることを強制した特定のエッジケースについてだ。

## オリジナルのキュー

オリジナルのコードにはRedis List操作でバックアップされたカスタム`Queue<T>`クラスがあった：

```typescript
// オリジナルのqueue.ts — 概念的にこれに似ている
class Queue<T> {
  constructor(private readonly redis: Redis, private readonly key: string) {}

  async push(item: T): Promise<void> {
    await this.redis.lpush(this.key, JSON.stringify(item))
  }

  async pop(): Promise<T | null> {
    const result = await this.redis.brpop(this.key, 0) // ブロッキングpop、0 = 永遠に待つ
    if (!result) return null
    return JSON.parse(result[1]) as T
  }
}
```

`LPUSH`でエンキュー、`BRPOP`でブロッキング待機付きでデキュー。これは教科書的なRedisキュー実装だ。Redisは`BRPOP`がアトミックであることを保証する——1つのワーカーだけが各アイテムを取得する——ので理論上、動作する分散キューがある。

理論上は。

### 問題

**リトライなし。** ワーカーがジョブを受け取ってクラッシュした場合——ネットワークの問題、OOMキル、未処理例外——ジョブは消えた。`BRPOP`は返すときにリストからアイテムを削除する。プロセスがポップ後だが作業完了前に死んだ場合、ジョブは消える。これへの可視性はない：失敗カウンターなし、デッドレターキューなし、アラートなし。学生の提出は結果なしで戻ってこない。

**実際にはマルチプロセス安全ではない。** `BRPOP`はアトミック、はい。単一のRedisリストを競合する複数のワーカーは実際には問題ない——それぞれが各アイテムを取得する。問題はワーカーが真に独立していなかったことだ：NestJSサービスレイヤーを通じて状態を共有していた。PM2クラスタモードでは、これは`pendingSet`問題と同じクラスのバグにつながった——リクエストライフサイクルがプロセス境界をまたいだときに壊れるステートフルな仮定。

**ジョブライフサイクルの可視性なし。** ジョブがスタックしているか？キューがバックアップしているか？この提出はどれくらい待っているか？これらは観測可能ではなかった。Redisキーを見るといくつかのアイテムを持つリストが見えるが、何かが処理されているか、どれくらい待っているか、失敗したかどうかはわからなかった。

**優先度付けなし。** すべてのジョブは先入れ先出しだった。古い提出の再ジャッジとコンテスト中のライブコンテスト提出は同じ扱いを受けた。

## なぜBull（BullMQではなく）

最初に命名の混乱に対処したい：`@nestjs/bull`はBull v4を内部で使用しており、類似性にもかかわらずBullMQでは*ない*。BullMQは同じチームによるBullの完全な書き換えで、ネイティブTypeScriptと異なるAPIを持つ。プロジェクトには依存関係としてBullMQもある（両方が`package.json`にある）が、キューインフラストラクチャは`@nestjs/bull`を介してBull v4を使用する。

この選択の理由は執筆時点でのエコシステムの成熟度に帰着する。`@nestjs/bull`は安定したNestJS統合、NestJS規約に一致するデコレータ（`@Processor`、`@Process`）、そして十分にテストされたアダプターを持っている。BullMQのNestJS統合（`@nestjs/bullmq`）は新しく、まだ進化中だ。コアジャッジパイプラインには、より戦闘でテストされたオプションが欲しかった。

どちらを使っても概念的な改善は同じだ：Bull/BullMQは両方とも適切なジョブライフサイクル、リトライ、デッドレターキュー、可観測性を提供する。手作りのRedis Listアプローチはこれらを何も提供しない。

### ジョブライフサイクル

Bullでは、ジョブは状態を遷移する：

```
waiting → active → completed
                ↘ failed → (retry) → waiting
                         → (max retries) → failed permanently
```

ワーカーがジョブを取り上げると、`active`に移動し「ロック」に保持される——ジョブが処理されている間定期的に延長される別のRedisキー。ワーカーが死んだ場合、ロックは期限切れになり、Bullはジョブを`waiting`に戻してリトライする。これが`BRPOP`との根本的な違いだ：ワーカーがジョブを取り上げてもジョブは消えない。

`bull-board`はジョブ数、失敗理由、リトライ履歴を表示するWebダッシュボードを提供する。これだけでも切り替えの価値がある——本番で何かが壊れたとき、何が起こったかを正確に見ることができる。

## ジャッジパイプライン

ジャッジパイプラインには2つのキューと2つのワーカー、さらにheng-controllerからOJサーバーへのHTTPコールバックがある。

```
提出 → [judge-tx queue] → JudgeTxWorker → heng-controller
                                                 ↓ (HTTP callback)
                                          [judge-rx queue] → JudgeRxWorker → ReceiveService
```

### JudgeTxWorker：ジョブの送信

ここでいくつかのことを説明する価値がある：

**judgeId。** heng-controllerにジョブを提出するたびに、新しい32文字の16進IDを生成する。これはheng-controllerの内部IDではない——我々のものだ。heng-controllerを呼び出す前に生成し、HTTP呼び出しを行う前にRedisに保存する。judgeIdはコールバックURLに埋め込まれているので、heng-controllerが結果を送り返すとき、URLパスにjudgeIdが含まれる。

**HMAC署名。** `createJudge`は`hengClient.createJudge()`を呼び出し、heng-sign-jsプロトコルに従って署名されたヘッダーを追加する：SHA-256ボディハッシュ + リクエスト文字列上のHMAC-SHA256。これはコードレビューで文書化したオリジナルの`rejectUnauthorized: false`を置き換えた——無効化されたTLS検証の代わりに適切な相互認証。

**throw。** heng-controllerへのHTTP呼び出しが失敗した場合、throwする。Bullは`@Process()`からの例外を見てリトライをスケジュールする。ジョブは`active`から`waiting`に戻り、次の試行は新しいjudgeIdを生成して再試行する。これは手作りキューにはなかったリトライ動作だ。

### JudgeRxWorker：結果の受信

heng-controllerはコールバックURL経由でHTTP POSTで結果を送り返す。

### アンチリプレイ設計

`judge-ids:{submissionId}` Redis Setは微妙なことをしている：アンチリプレイ保護を実装している。

JudgeTxWorkerがジョブを提出するとき、呼び出す：
```
SADD judge-ids:{submissionId} {judgeId}
```

JudgeRxWorkerが結果を受け取るとき、チェックする：
```
SISMEMBER judge-ids:{submissionId} {judgeId}
```

これがfalseを返す場合、ジョブは拒否される。これはいくつかのケースを処理する：

**古い提出からの古い結果。** 提出が再ジャッジされた場合（新しいjudgeIdを生成）、古いジャッジ実行からの結果がまだ到着するかもしれない。古いjudgeIdはもうセットにない（古い結果が処理されたときに削除された、または新しい提出実行のためにセットになかった）ので、無視される。

**重複コールバック。** heng-controllerは同じコールバックを2回送信するかもしれない（ネットワークリトライ、heng-controllerのクラッシュと再起動）。2回目の到着は、最初の処理後にjudgeIdがすでにセットから削除されていることを発見するので、ドロップされる。

**不正な結果。** `/heng/finish/{submissionId}/{someId}`への任意のPOSTは、judgeIdが実際のJudgeTxWorker実行によって登録されていないため、SISMEMBERチェックを通過しない。（HMAC署名チェックが最初の防御層を提供する；SISMEMBERチェックが2番目を提供する。）

## 本当の失敗モード：At-Least-Once配信

最も考える必要があったエッジケースはこれだ：heng-controllerが正常にコールバックしたが、JudgeRxWorkerがコールバックを受け取った*後*だが`receiveResult`を完了する*前*にクラッシュした場合どうなるか？

これはat-least-once配信問題だ。Bullはat-least-onceを保証する：ジョブが失敗した場合（例外またはタイムアウト）、リトライする。これは`receiveResult`が同じ結果に対して複数回呼び出される可能性があることを意味する。

`receiveResult`が2回呼び出された場合、間違ったことをするか？データベーストランザクション内で：

```typescript
await manager.update(Submission, submissionId, { status: finalStatus, time, memory })
await manager.increment(Problem, { id: submission.problemId }, 'submits', 1)
// ...
```

`manager.increment(..., 'submits', 1)`は冪等ではない。2回呼び出されると、提出カウントが2回増加する。それはバグだ。

実用的な答えは：このエッジケースはまれで、`receiveResult`は完全なデータベーストランザクションでラップされている。リトライが提出がすでに最終状態（保留中ではない）にあることを検出した場合、ショートサーキットできる。

これはまだ完全には解決していない。アーキテクチャは正しく、失敗モードは理解されており、緩和策は本番で問題を引き起こす可能性を極めて低くしている。しかし「at-least-once配信は冪等なコンシューマーを意味する」は取り組み続ける必要のある要件だ。

## 実際に変わったこと

提出パイプラインは：リトライなし、可視性なし、ワーカークラッシュでの静かなジョブロスを持つ手作りの`Queue<T>`から——リトライロジック、Webダッシュボード、適切なジョブライフサイクル追跡、明示的なアンチリプレイ保護を持つBull管理キューへ。

観測可能な違い：以前は静かに消える可能性があった提出（ワーカークラッシュ、heng-controllerへのネットワークエラー）は今や自動的にリトライする。ダッシュボードでジョブがバックアップしているか、失敗したジョブがどのようなエラーメッセージを持っているか、各ジョブが何回リトライを消費したかを見ることができる。

judge-tx → judge-rxの2キュー設計は、OJサーバーがユーザーリクエストとインラインでheng-controllerへの同期HTTP呼び出しを行おうとしていないことを意味する。提出エンドポイントはジョブをエンキューしてすぐに返す；キューが非同期で残りを処理する。負荷がかかると、HTTPハンドラーでタイムアウトする代わりにジョブがキューで優雅にバックアップする。

judgeId / SADDアンチリプレイメカニズムは構築する必要があったことに最も驚いた部分だ。メッセージキューが冪等性を処理すると仮定していた。しない——配信保証のみを処理する。冪等性はコンシューマーの問題であり、この場合、コンシューマーは我々だ。

それが残る教訓だ：「キューを使っている」は「メッセージ処理を解決した」を意味しない。配信保証を得たことを意味する。それらの保証で何をするか——処理を冪等にする、重複を処理する、クラッシュシナリオを考え抜く——はまだあなたの問題だ。
