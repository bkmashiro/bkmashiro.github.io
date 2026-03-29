---
title: "OJリーダーボードが止まった理由——RedisソートセットはどうO(log N)で直したか"
description: "フルテーブルスキャンのランキングが半日間イベントループをブロックした件と、RedisのSorted SetでO(log N)のリアルタイム更新を実現した設計。"
date: 2026-03-08
readingTime: true
tag:
  - システム
  - Redis
  - パフォーマンス
  - OJ
outline: [2, 3]
---

私がメンテナンスしているOJプラットフォームLeverageのコンテスト中、リーダーボードの更新が止まった。約半日の間。学生はコードを提出して判定を受けていたが、ランキングは変化しなかった。最終的にNode.jsのイベントループを深刻にブロックしていた15分のcronジョブが原因だとわかった。

この記事は何が間違っていたか、なぜ直感的な修正が実際には何も解決しないか、そして15分のバッチ処理全体をO(log N)のリアルタイム更新に置き換えたRedis Sorted Setの設計について説明する。

## 元の設計

ランキングシステムはこのように動いていた：

```typescript
// rank.service.ts — 簡略版
async rebuildSaAndRank(divisionId: number, ids: number[]) {
    // Step 1: 全提出を読み込む
    const submissions = await Submission.createQueryBuilder('s')
        .where('s.divisionId = :divisionId', { divisionId })
        .orderBy('s.createdAt', 'ASC')
        .getRawMany()
    
    // Step 2: メモリ内で各ユーザーのスコアを計算
    const userDatas: Map<UserId, ScoreAggregate>[] = []
    for (const submission of submissions) {
        // ... 各提出を処理、ユーザースコアマップを更新
        // cloneDeepで完全な日次履歴を作成
    }
    
    // Step 3: 全員をソート
    const ranked = [...userDatas[0].entries()]
        .sort(([, a], [, b]) => compareScores(a, b))
    
    // Step 4: 結果を書き戻す — ユーザーごとに1つのUPDATE
    for (const [userId, scoreAggregate] of ranked) {
        await ContestUser.update({ userId, contestId }, {
            rank: /* 計算されたランク */,
            score: scoreAggregate.score,
        })
    }
}
```

cronジョブが15分ごとに発火し、どのコンテストの再構築が必要かを`pendingSet`で確認し、この関数を呼び出していた。

## 実際に何が起きていたか

なぜこれがブロックするのかを分析しよう。

### O(N log N)問題

`Array.sort()`は同期的なJavaScriptだ。V8ではTimSort——最悪ケースO(N log N)——でメインスレッド上で実行され、制御を譲らない。大規模コンテストで10,000件の提出がある場合：

- 10,000件 × ~200バイト ≈ データベースからの2MBの生データ
- 日次状態のスナップショットのための複数の`cloneDeep`呼び出し
- 全ユーザーのO(N log N)ソート
- N個の独立した`UPDATE`文、それぞれが独自のawaitサイクルを持つ

コンテスト当日、人気のコンテストには300ユーザーの50,000件の提出があるかもしれない。再構築には実際の時間で30-60秒かかり、ソート自体が数秒のCPUを消費する。そのソートの間、**他のリクエストは何も処理されない**。受信した提出はキューに積まれ、学生向けのページはタイムアウトする。cronジョブが最終的に完了しても、次の呼び出しがすぐに始まり、プロセスは回復できない。

### `setImmediate`が助けにならない理由

自然な直感：「チャンクの間でイベントループに制御を渡せばいい」。

しかし問題は根本的だ：データはすでにメモリにあり、計算は正しいランキングを生成するためにすべてのデータを見ることを本質的に必要とする。他のすべての人のスコアを知らずに1位にランク付けできない。チャンク化はCPU作業を遅らせるが、N個の独立したデータベース書き込みは修正しない。

## Redis Sorted Setによる解決策

Redis Sorted Set（`ZSET`）は、すべてのメンバーに関連する浮動小数点スコアを持つデータ構造だ。コア操作：

```
ZADD key score member     — O(log N)
ZRANK key member          — O(log N)、最低からの0インデックス
ZREVRANK key member       — O(log N)、最高からの0インデックス
ZRANGE key start stop     — O(log N + M)
```

アイデア：バッチ再構築の代わりに、インクリメンタルに維持する。提出が判定されるたびにRedisのスコアを更新する。ランキングは常に最新だ。

### スコアエンコード

典型的な競技プログラミングコンテストでは、ランキングは：
1. 解いた問題数（多い方が良い）
2. 総ペナルティ時間（少ない方が良い、タイブレーカー）

両方を一つの浮動小数点数にエンコードする必要がある。トリック：整数部分に解いた問題数を使い、小数部分（反転）にペナルティを使う。

```typescript
function encodeScore(problemsSolved: number, penaltyMinutes: number): number {
    const MAX_PENALTY = 100000
    return problemsSolved * MAX_PENALTY + (MAX_PENALTY - penaltyMinutes)
}
```

3問解いてペナルティ120分のユーザー：`3 * 100000 + (100000 - 120) = 399880`
3問解いてペナルティ60分のユーザー：`3 * 100000 + (100000 - 60) = 399940`
4問解いたユーザー：`4 * 100000 + ... ≥ 400000`

`ZREVRANK`（スコアの降順によるランク）が競技ランキングを自動的に正確に返す。

### 更新フロー

```typescript
// 提出がACになるたびに呼ばれる
async onAccepted(contestId: number, userId: number, penaltyMinutes: number) {
    const key = `ranking:${contestId}`
    
    // アトミックな読み込み・更新・書き込みのためのLuaスクリプト
    const luaScript = `
        local current = redis.call('ZSCORE', KEYS[1], ARGV[1])
        local solved = 0
        local penalty = 0
        if current then
            solved = math.floor(tonumber(current) / 100000)
            penalty = 100000 - (tonumber(current) % 100000)
        end
        solved = solved + 1
        penalty = penalty + tonumber(ARGV[2])
        local newScore = solved * 100000 + (100000 - penalty)
        redis.call('ZADD', KEYS[1], newScore, ARGV[1])
        return newScore
    `
    
    await redis.eval(luaScript, 1, key, userId.toString(), penaltyMinutes.toString())
}

// ランクをクエリ
async getRank(contestId: number, userId: number): Promise<number> {
    const rank = await redis.zrevrank(`ranking:${contestId}`, userId.toString())
    return rank !== null ? rank + 1 : -1  // 1インデックス
}
```

LuaスクリプトはREAD-MODIFY-WRITEをアトミックにするために重要だ。これなしでは、同じユーザーからの2つの同時AC（再ジャッジシナリオで起こりえる）が競合し、間違ったスコアになる可能性がある。

## 何を得たか

差は歴然だ：

| | 以前 | 以後 |
|---|---|---|
| 更新レイテンシ | 最大15分 | < 1ms |
| 更新複雑度 | O(N log N) + N回の書き込み | O(log N) |
| イベントループのブロック | あり（数秒間）| なし |
| マルチプロセス安全 | いいえ | はい（Redisは共有） |
| ランキング精度 | 古い、最終的に正確 | 常に最新 |

サーバーをフリーズさせたコンテストには約50,000件の提出があった。Redis Sorted Setがあれば、それらの50,000件の提出それぞれが1つの`ZADD`——O(log N)、ブロックなし——をトリガーするだけで、15分タイマーと大規模再構築の代わりになる。

半日のフリーズは、バッチ再構築が存在しなくなるので、もう起きない。
