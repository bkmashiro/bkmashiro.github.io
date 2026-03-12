---
title: "1回のコードレビューから29のバグ：テストゼロのNestJS OJが教えてくれたこと"
description: "本番Online Judgeをレビューして見つけたバグの深堀り——そしてコードレビューがどのように機能すべきかについてそれらが明らかにすること。"
date: 2026-03-08
readingTime: true
tag:
  - システム設計
  - コードレビュー
  - バグ
  - TypeScript
outline: [2, 3]
---

数ヶ月前、何年も本番で稼働していたNestJS Online JudgeプラットフォームであるLeverageの本格的なコードレビューを始めた。テストなし。リンター強制なし。正式なレビュープロセスなし。ただ締め切りのプレッシャーの下で、機能ごとに有機的に成長してきたコードだけ。

29の文書化された問題を持って出てきた。いくつかは些細なスタイルのことだった。6つはしばらく画面を見つめて「これがどうやって動いていたんだ？」と思うようなバグだった。

この投稿はその6つについてだ。

## レビュープロセス

特定のバグに入る前に、方法論について一言。大規模でテストされていないコードベースをレビューするとき、ランダムな探索はうまくいかない。見落としが出る。私は3つのエントリーポイントを使用した：

**1. バグマップとしてのコミット履歴。** `fix/issues`、`hotfix/ranking`などの名前のブランチは宝の山だ。コミットメッセージは開発者が*何が間違っているか知っていた*ことを教えてくれる。それらのdiffを逆方向に読む——修正前のコードはまさにコードベースの他の場所で探しているようなコードだ。

**2. 読む前に優先度トリアージ。** すべての発見を記述を書く前に🔴高/🟡中/🟢低として分類した。これにより「これは本当に重要なのか？」と問うことを強制し、スタイルの細かい指摘でレポートを埋めることを避けられる。

**3. サービスレイヤーの深い読み込み。** 構造の良いNestJSアプリではコントローラーは薄い。本当のロジックはサービスに存在する。コアモジュールのすべてのサービスファイルを一行ずつ読んだ：`ReceiveService`、`RankService`、`SubmissionService`、`UserService`。

## 話す価値のある6つのバグ

### 1. なかった`await`（すべてが間違っている）

```typescript
// receive.service.ts — データベーストランザクション内
async function increment(
    User: typeof AutoTimingEntity,
    Problem: typeof AutoTimingEntity,
    users: UserId,
    problems: ProblemId,
    path: string,
) {
    manager.increment(User, users, path, 1)  // ← awaitなし
    manager.increment(Problem, problems, path, 1)  // ← awaitなし
}
```

`increment`ヘルパーは`async`と宣言され、Promiseを返す`manager.increment(...)`を呼び出している。しかしどちらの呼び出しも`await`されていない。関数はどちらのインクリメントも完了する前に返る。

呼び出し元はその後`await increment(...)`を行い、`async`関数自体の完了を待つ——しかし関数はすでに返している。データベースのインクリメントはアタッチされていないPromiseとして発火し、トランザクションコミットと競合する。

トランザクションはインクリメントが実行される前にコミットするかもしれない。または接続がプールに返された後に実行されるかもしれない。結果：ACカウントと提出カウント——Online Judgeのコア統計——が静かに、ランダムに間違っている。時に1。負荷がかかっている場合はもっと多く。

修正は2つの`await`キーワード。影響範囲はこれまでに評価されたすべての提出。

### 2. 何もフィルタリングしなかったフィルター

```typescript
// rank.service.ts — ID範囲で学生をフィルタリング
const rangeMatch = filtersText.match(/(\d{10})-(\d{10})/)
// ...
for (const e of enrollments) {
    if (rangeMatch && !e.match(rangeMatch[0])) {
        filteredEnrollments.add(e)
    }
}
```

意図：`2021010001-2021019999`のような範囲パターンで学生登録番号のリストをフィルタリングする。バグ：`rangeMatch`は`filtersText.match()`の結果だ——*フィルターテキスト全体*からのマッチオブジェクトであり、個々の登録番号からではない。`e.match(rangeMatch[0])`は各登録番号に対してリテラル部分文字列として完全な範囲文字列をマッチしようとする。

結果：範囲フィルターは、範囲文字列`"2021010001-2021019999"`が登録番号内にそのまま現れるかどうかをチェックする以外は何もしない。現れない。すべての範囲フィルターは静かに何もフィルタリングしない。

コードを読んで「`rangeMatch[0]`には実際に何が含まれているのか？」と問うことでこれを見つけた。それはマッチした文字列、つまり範囲式全体だ。修正は`filtersText`ではなく`e`（各登録）に対してマッチを実行すべきだ。

### 3. 各プロセスは独自の宇宙に住んでいる

```typescript
// receive.service.ts — 修正前
const pendingSet: Array<Set<number>> = [
    new Set<number>(), // Division.Exercise
    new Set<number>(), // Division.Course
    new Set<number>(), // Division.Contest
]

// 提出結果が到着したときに呼び出される
pendingSet[divisionId].add(contestOrCourseId)

// 15分ごとにcronジョブによって呼び出される
async refresh() {
    for (let i = 0; i < pendingSet.length; i++) {
        if (pendingSet[i].size > 0) {
            await this.rankService.rebuild(i, [...pendingSet[i]])
            pendingSet[i].clear()
        }
    }
}
```

「サーバー」を単一のプロセスとして考えれば、これは問題なく見える。PM2クラスタモード（例えば4ワーカー）では、開発では再現がほぼ不可能な方法で壊れている。

プロセスAがジャッジャーコールバックを受信し、自分の`pendingSet`に追加する。プロセスBがcronジョブを実行し、自分の`pendingSet`をチェックする——空だ。プロセスAのcronジョブが実行され、ランキングを正しく再構築する——一度だけ——そしてセットをクリアする。しかし次のコールバックバッチをプロセスBが受信すると、それらはプロセスBのセットに入り、プロセスAのcronジョブはそれらを決して見ない。

修正は`pendingSet`をRedisに移動すること：

```typescript
// 修正後 — Redisバックアップの共有状態
const key = `pending-rank-rebuild:${division}`
await this.redisService.do(e => e.sadd(key, contestOrCourseId))

// refresh()内：
const ids = await this.redisService.do(e => e.smembers(key))
if (ids.length > 0) {
    await this.redisService.do(e => e.del(key))
    await this.rankService.rebuild(divisionId, ids.map(Number))
}
```

このバグは特に厄介だ。なぜなら孤立しては間違っていない——デプロイメント設定と組み合わせたときだけ間違っている。

### 4. SSL？何それ？

```typescript
// heng.service.ts
private agent = new https.Agent({
    rejectUnauthorized: false,
})
```

一行。ジャッジャーインフラストラクチャへのすべてのHTTPSリクエスト——コードを受け入れて判定を返すシステム——が証明書検証を完全にバイパスする。OJサーバーとジャッジャー間の中間者は任意の評価結果を注入できる：任意の提出を受理、任意の提出を不合格、提出されたコードを読む。

これは開発中に一度やりやすいことだ（「証明書の問題は後で修正しよう」）、そして永遠に忘れやすい。本番で生き残っていた。

### 5. すべてのパスワードは1つのキーに属する

```typescript
static hash(password: string): string {
    const md5 = crypto.createHash('md5').update(password).digest('hex')
    return crypto.createHmac('sha256', config.security.hmac).update(md5).digest('hex')
}
```

ユーザーごとのソルトがない。`hmac`キーはグローバルで静的だ。

これは見た目より悪い。MD5はルックアップテーブルで逆変換可能だ。固定キーを持つHMAC-SHA256は本質的にキー付きハッシュだ——キーを知っている場合（設定を侵害した後に攻撃者がそうなる）、任意のパスワードのハッシュを事前計算できる。ソルトがないため、同じパスワードを持つ2人のユーザーは同一のハッシュを持ち、クラッキング前でも情報が漏洩する。

コストファクター12のbcryptはこれをすべて解決する：自動的にハッシュごとのソルトを生成し、設計上GPU耐性があり、よく理解されたセキュリティモデルを持つ。

### 6. 配列上の`for...in`（古典的なJavaScriptの落とし穴）

```typescript
// cache.service.ts
async getHashes(keys: string[]): Promise<Record<string, string>> {
    const cached = await this.redisService.do(e => e.hmget('cache', ...keys))
    const cache: Record<string, string> = {}
    
    for (const k in keys) {  // ← 配列上のfor...in
        if (cached[k] !== null) {
            cache[k] = cached[k]  // kは'0', '1', '2'...であり、キー文字列ではない
        }
    }
    return cache
}
```

配列上の`for...in`は*インデックス*を文字列として与える：`'0'`、`'1'`、`'2'`。コードはその後`cache['0'] = cached['0']`を格納する——キーとして数値インデックスを使用する——しかし呼び出し元はキャッシュが`'problem:42'`のような実際の文字列キーでキー付けされていることを期待する。

キーが一致しないため、キャッシュルックアップは何も見つからない。キャッシュは静かに常に空だ。すべての後続の呼び出しはメモリ内キャッシュの代わりにRedisに行く。近くの2つの`@ts-ignore`コメントは、誰かが何かが間違っていることに気づいたが、理解するよりも型エラーを抑制することを選んだことを示唆している。

`for...of`がこれを修正する。または`.reduce()`を使用して型にガイドさせる。

## 持ち帰ったもの

**欠落した`await`はJavaScriptの原罪だ。** テストのない重度の非同期コードベースでは、発火して忘れるバグがいたるところにある。TypeScriptはいくつかをキャッチする（`no-floating-promises`が有効な場合）が、すべてではない。すべてのカウンター更新を明示的にテストする。

**デプロイメントトポロジーは正確性の一部だ。** `pendingSet`バグはPM2クラスタのためにのみ存在する。コードはもともと書かれた頃のデプロイメント設定に対しては正しかった。設定が変更されたとき、テストがないためテストが壊れを捕捉しなかった。

**1つの`false`はすべての暗号を台無しにできる。** SSLとパスワードのバグは両方とも「正しく見えるがセキュリティレイヤーで間違っているコード」のケースだ。セキュリティプロパティは自動的に合成されない——各仮定を明示的に検証する必要がある。

**何よりも先に修正ブランチを読む。** `fix/issues`の履歴はどこを見るべきかを正確に教えてくれた。すべてのホットフィックスは告白だ：「これは壊れていて、私たちはそれを知っていた。」それらが最も価値のある読み取りターゲットだ。

29のバグ、ゼロテスト、何年もの本番使用。コードはこれらのほとんどに誰も気づかないほど十分にうまく機能していた。「本番で動作している」と「正しい」は同じことではない。
