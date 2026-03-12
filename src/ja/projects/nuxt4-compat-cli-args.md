---
title: "Nuxt 4互換モードはCLI引数を間違って渡すと静かに壊れる"
description: "`pnpm dev -- --host 0.0.0.0`がnuxt.config.tsをバイパスしてウェルカムページを表示する理由——そして一行の修正。"
date: 2026-03-09
readingTime: true
tag:
  - Nuxt
  - Vue
  - デバッグ
  - フロントエンド
outline: [2, 3]
---

深夜2時。Leverage OJフロントエンドは何時間も快適にページを提供していたが、何かがクラッシュを引き起こした。素早く再起動した後、すべてのルートがデフォルトのNuxtウェルカム画面を返した：

> *app.vueの`<NuxtWelcome />`を自分のコードに置き換えてこのウェルカムページを削除...*

コードは変更されていなかった。`app/app.vue`は無傷だった。では何が起こったのか？

## セットアップ

プロジェクトはNuxt 4互換フラグ付きの**Nuxt 3.21.1**を使用している：

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  future: { compatibilityVersion: 4 },
  // ...
})
```

`compatibilityVersion: 4`を使用すると、Nuxt 3はNuxt 4のディレクトリ規則を採用する：ソースファイルはルートではなく`app/`に配置される。つまり`app/app.vue`、`app/pages/`、`app/layouts/`など。

これは数ヶ月間正常に動作していた。

## すべてを壊した再起動

ネットワーク経由で（Tailscale経由で）開発サーバーを公開するために、次のコマンドで再起動した：

```bash
PORT=3001 pnpm dev -- --host 0.0.0.0
```

Nuxtは起動し、HTTP 200を返し、そして...ウェルカムページを表示した。

## 症状のデバッグ

最初の直感：キャッシュ。`.nuxt/`、`node_modules/.cache/`をクリアした。変化なし。

それから起動ログで何かに気づいた。通常、Nuxt 4互換モードは次のように出力する：

```
[nuxt] ℹ Running with compatibility version 4
```

その行が**なかった**。そしてNitroビルドが疑わしいほど速かった——通常の約1800msではなく約400ms。Nuxtは`app/`をまったくスキャンしていなかった；内部のデフォルトを使用していた。

## 実際の原因

犯人は`-- --host 0.0.0.0`だった。

シェルでは、`--`は「このコマンドのオプションの終わり；それ以降はすべてサブプロセスに渡す」を意味する。したがって`pnpm dev -- --host 0.0.0.0`は`--host 0.0.0.0`を`nuxt dev`に渡す。それは意図通りだ。

しかしNuxt 3.21.1では、`compatibilityVersion: 4`が設定されているときに、CLI引数の解析方法の何かが`--host`（または他のフラグと一緒にある場合）で**静かに`nuxt.config.ts`の読み取りをスキップ**する原因となる。サーバーは素のデフォルト設定で起動する——`future`なし、`srcDir`なし、modulesなし——そして`NuxtWelcome`のレンダリングにフォールバックする。

私は間違った方向にしばらく時間を費やした：明示的に`srcDir: 'app'`を追加する、`compatibilityVersion`を削除する、`dir.*`設定を試す——すべてが状況を悪化させるか、何もしなかった。

## 修正

`--host`をCLIフラグとして渡すのをやめる。代わりに環境変数を使用する：

```bash
# ❌ 壊れる — 静かにnuxt.config.tsをスキップ
PORT=3001 pnpm dev -- --host 0.0.0.0

# ✅ 動作する — Nuxtが正しく設定を読み込む
NUXT_HOST=0.0.0.0 PORT=3001 pnpm dev
```

環境変数アプローチでは、起動ログは次のように表示される：

```
[nuxt] ℹ Running with compatibility version 4
[nitro] ✔ Nuxt Nitro server built in 1841ms   ← 適切なスキャン時間
```

そしてHTMLのタイトルは`<title>Welcome to Nuxt!</title>`ではなく`<title>Leverage OJ</title>`になる。

## なぜこれが起こるのか

私の最善の推測：Nuxt 4互換モードは設定がブートストラップされる方法を変更する。`compatibilityVersion`フラグは設定読み込みパイプラインの早い段階で処理され、特定のCLI引数の組み合わせがその早期初期化を中断するバグ（または文書化されていない動作）がある。サーバーはまだ正常に起動するため、エラーは出ない——ただ静かな劣化した動作だけだ。

まだNuxtのissueを提出していないが、3.21.1 + `compatibilityVersion: 4`で再現可能だ。

## 教訓

1. **起動ログ行の欠如はシグナルだ。** `[nuxt] ℹ Running with compatibility version 4`が表示されないことは、設定が読み込まれなかったことを意味する——それだけだ。
2. **ビルド時間は正確性の代理だ。** 400ms Nitroビルド = ファイルがスキャンされていない。1800ms = 正常。速すぎると感じたら、何かが間違っている。
3. **互換モードでNuxt devに`--`経由で`--host`を渡さない。** 代わりに`NUXT_HOST`を使用する。
4. **設定をいじらない。** 設定がずっと正常だったのに、`srcDir`、`dir.*`、`compatibilityVersion`を追加/削除するのに30分費やした。疑わしいときは、復元して他の場所を見る。
