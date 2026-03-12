---
title: "OJリーダーボードがフリーズした理由——Redis Sorted Setsでどう直したか"
description: "半日イベントループをブロックした全テーブルスキャンランキングと、O(log N)更新でリアルタイムにするRedis Sorted Set設計。"
date: 2026-03-08
readingTime: true
tag:
  - システム設計
  - Redis
  - パフォーマンス
  - OJ
outline: [2, 3]
---

私がメンテナンスしているオンラインジャッジプラットフォームLeverageでのコンテスト中、リーダーボードが更新を停止した。約半日間。学生はコードを提出し、判定を受けていたが、ランキングは変わらなかった。最終的に15分のcronジョブがNode.jsイベントループを非常に深刻にブロックし、プロセスが応答しなくなったことまで追跡した。

この投稿は何が間違っていたか、なぜ明らかな修正が実際には何も修正しないか、そしてcronジョブ全体をO(log N)リアルタイム更新に置き換えるRedis Sorted Set設計についてだ。

## オリジナルの設計

ランキングシステムはこのように機能していた：

```typescript
// rank.service.ts — 簡略化
async rebuildSaAndRank(divisionId: number, ids: number[]) {
    // ステップ1：すべての提出をロード
    const submissions = await Submission.createQueryBuilder('s')
        .where('s.divisionId = :divisionId', { divisionId })
        .orderBy('s.createdAt', 'ASC')
        .getRawMany()
    
    // ステップ2：メモリ内で各ユーザーのスコアを計算
    const userDatas: Map<UserId, ScoreAggregate>[] = []
    for (const submission of submissions) {
        // ... 各提出を処理し、ユーザースコアマップを更新
        // cloneDeepを通じて完全な日次履歴を作成
    }
    
    // ステップ3：全員をソート
    const ranked = [...userDatas[0].entries()]
        .sort(([, a], [, b]) => compareScores(a, b))
    
    // ステップ4：結果を書き戻す — ユーザーごとに1つのUPDATE
    for (const [userId, scoreAggregate] of ranked) {
        await ContestUser.update({ userId, contestId }, {
            rank: /* 計算されたランク */,
            score: scoreAggregate.score,
        })
    }
}
```

cronジョブが15分ごとに発火し、どのコンテストが再構築を必要とするかを`pendingSet`でチェックし、この関数を呼び出した。

## 実際に起こったこと

なぜこれがブロックするのか順を追って説明しよう。

### O(N log N)問題

`Array.sort()`は同期JavaScriptだ。V8ではTimSort——最悪ケースO(N log N)——でメインスレッドでyieldせずに実行される。大きなコンテストで10,000件の提出がある場合：

- データベースから10,000レコード × 約200バイトずつ ≈ 2MBの生データ
- 日次状態をスナップショットするための複数の`cloneDeep`呼び出し
- すべてのユーザーでO(N log N)ソート
- N個の個別の`UPDATE`ステートメント、それぞれ独自のawaitサイクル

コンテスト日には、人気のあるコンテストで300ユーザーにわたる50,000件の提出があるかもしれない。再構築は30-60秒のウォールクロック時間がかかり、ソート自体が数秒の純粋なCPUを消費する可能性がある。そのソート中、**他のリクエストは処理されない**。着信提出が山積みになる。学生向けページがタイムアウトする。cronジョブは最終的に完了するが、次の呼び出しがすぐに開始し、プロセスは決して回復しない。

### なぜ`setImmediate`は助けにならないか

自然な直感：「チャンク間でイベントループにyieldすればいい」。

問題は根本的だ：データはすでにメモリにあり、計算は本質的に正しいランキングを生成するためにすべてを見る必要がある。1番目の人をランク付けするには他の全員のスコアを知る必要がある。チャンキングはCPU作業を延期するが、チャンク間の状態共有が必要な場合のO(N²)通信コストは変わらず、N個の個別データベース書き込みも修正しない。

### なぜ`worker_threads`は症状を治療しているのか

計算をワーカースレッドに移動するとメインイベントループのブロックは解除される、それはマシだ。しかしまだある：
- スレッド境界をまたいでシリアライズ・デシリアライズされる10MB以上のデータ
- N個の個別データベース書き込み（DB接続プールが飽和すると潜在的に遅くなる）
- 負荷がかかると遅れる可能性のあるcronジョブ
- 最大15分古いランキング

ランキングは根本的にまだバッチだ——ただ別の場所でバッチを行っているだけだ。

## Redis Sorted Set解決策

Redis Sorted Sets（`ZSET`）は、すべてのメンバーが関連付けられた浮動小数点スコアを持つデータ構造だ。コア操作：

```
ZADD key score member     — O(log N)
ZRANK key member          — O(log N)、最低から0インデックス
ZREVRANK key member       — O(log N)、最高から0インデックス
ZRANGE key start stop     — O(log N + M) ここでMは返されるメンバー
ZRANGEBYSCORE key min max — O(log N + M)
```

アイデア：バッチでランキングを再構築する代わりに、インクリメンタルに維持する。提出がジャッジされるたびに、Redisのスコアを更新する。ランキングは常に最新だ。

### スコアエンコーディング

典型的な競技プログラミングコンテストでは、ランキングは：
1. 解いた問題数（多いほど良い）
2. 合計ペナルティ時間（少ないほど良い、タイブレーカー）

両方を単一のfloatにエンコードする必要がある。トリック：解いた問題数に整数部分を使用し、ペナルティに小数部分（反転）を使用。

```typescript
function encodeScore(problemsSolved: number, penaltyMinutes: number): number {
    // 典型的なコンテストでの最大ペナルティ：約1440分（24時間）
    // 欲しいのは：より多くの問題 = より高いスコア、より少ないペナルティ = より高いスコア
    const MAX_PENALTY = 100000
    return problemsSolved * MAX_PENALTY + (MAX_PENALTY - penaltyMinutes)
}
```

`ZREVRANK`（降順スコアでランク）は今や正しい競技ランキングを自動的に与える。

### 更新フロー

```typescript
// 提出がACとジャッジされるたびに呼び出される
async onAccepted(contestId: number, userId: number, penaltyMinutes: number) {
    const key = `ranking:${contestId}`
    
    // アトミックな読み取り-変更-書き込みのためのLuaスクリプト
    const luaScript = `
        local current = redis.call('ZSCORE', KEYS[1], ARGV[1])
        local solved = 0
        local penalty = 0
        if current then
            -- 既存スコアをデコード
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

// ランキング照会
async getRank(contestId: number, userId: number): Promise<number> {
    const rank = await redis.zrevrank(`ranking:${contestId}`, userId.toString())
    return rank !== null ? rank + 1 : -1  // 1インデックス
}

// トップN取得
async getTopN(contestId: number, n: number) {
    const members = await redis.zrevrange(`ranking:${contestId}`, 0, n - 1, 'WITHSCORES')
    // メンバーとスコアをパース...
}
```

Luaスクリプトが重要だ：読み取り-変更-書き込みをアトミックにする。それなしでは、同じユーザーからの2つの同時AC（再ジャッジシナリオで可能）が競合して間違ったスコアを生成する可能性がある。

### 再ジャッジの処理

提出が再ジャッジされたとき（判定がACから別のものに変わる、またはその逆）、スコアを再計算する必要がある。最もクリーンなアプローチ：再ジャッジが完了したら、ユーザーのスコアを提出履歴からゼロから再計算し、修正されたスコアで`ZADD`。

これはO(ユーザーの提出数)で、制限されていてまれ（再ジャッジは例外的）。

## マイグレーション戦略

スイッチを切り替えるだけではできない。MySQLに蓄積された何ヶ月もの既存のランキングデータがある。

**フェーズ1 — デュアルライト**：提出がジャッジされたとき、MySQL（既存フロー）とRedis Sorted Setの両方を更新する。Redisデータはまだユーザーに提供されない。これはRedisデータが頼る前に正しいという確信を与える。

**フェーズ2 — バックフィル**：既存のコンテストについて、提出履歴をリプレイしてSorted Setsを埋める。これはオフラインで実行できる。

**フェーズ3 — Redisから読む**：検証後、ランキングクエリエンドポイントをRedisから読むように切り替える。MySQLランキングデータはバックアップになる。

**フェーズ4 — cronジョブを削除**：Redisランキングが完全なコンテストサイクルで安定したら、15分再構築ジョブを削除。

## 何を得たか

違いは明白だ：

| | 以前 | 以後 |
|---|---|---|
| 更新レイテンシ | 最大15分 | < 1ms |
| 更新複雑度 | O(N log N) + N書き込み | O(log N) |
| イベントループブロッキング | あり、数秒 | なし |
| マルチプロセス安全 | いいえ（pendingSetバグ） | はい（Redisは共有） |
| ランキング精度 | 古い、最終的に正しい | 常に最新 |

サーバーをフリーズさせたコンテストは約50,000件の提出があった。Redis Sorted Setsでは、それらの50,000件の提出それぞれが単一の`ZADD`をトリガーする——O(log N)、決してブロックしない——15分タイマーをトリガーしてからバルク再構築の代わりに。

半日のフリーズは起こらない。なぜならバッチ再構築がもう存在しないから。
