---
title: "本番でのTypeORMマイグレーション：synchronize:trueから適切なマイグレーションへ"
description: "synchronize:trueがいずれ本番データベースを破壊する理由、そして実際に安全なTypeORMマイグレーションワークフローのセットアップ方法——別のdata-source.ts、条件付き設定、ロールバック戦略を含めて。"
date: 2026-03-08
readingTime: true
tag:
  - TypeORM
  - NestJS
  - データベース
  - PostgreSQL
  - バックエンド
outline: [2, 3]
---

TypeORMには、すべての開発者が開発で使用し、本番で実行したすべての開発者が後悔する設定がある：

```typescript
synchronize: true
```

`synchronize: true`を設定すると、TypeORMは起動時にエンティティ定義とデータベーススキーマを比較し、差分を自動的に適用する。魔法だ。即座だ。開発中にマイグレーションについて考える必要がなくなる。エンティティにカラムを追加し、サーバーを再起動すると、カラムが存在する。

これを本番で実行しない理由は、逆方向も同じように機能するからだ。

## `synchronize: true`の問題

### TypeORMはカラムをドロップする

エンティティ定義からカラムを削除すると、TypeORMはアプリ起動時に`DROP COLUMN`を発行する。警告なし、プロンプトなし、バックアップなし。そのカラムにデータがあった場合——数ヶ月のユーザーレコード、監査ログ、設定——消えた。

これは開発では結果なしに常に起こる。開発データは使い捨てだから。本番では、データ損失インシデントだ。

### すべての起動で実行される

`synchronize: true`では、アプリが起動するたびに——すべてのデプロイメント、クラッシュ後のすべての再起動、Kubernetesポッドで起動するすべてのコンテナ——TypeORMは完全な同期を実行する。2つのコンテナが同時に起動し、両方が同じテーブルを変更しようとすると、ロッキング問題や競合状態が発生する可能性がある。

標準的なシングルサーバーデプロイメントでは通常問題ない。任意の種類のクラスタやローリングデプロイメントでは、タイムボムだ。

### ロールバックできない

`synchronize: true`はマイグレーションファイルを生成しない。何が変わったかの記録はない。同期が何かを壊した場合——例えばTypeORMがカラムタイプが変更されたと判断してデータを破壊する暗黙のalterを行った場合——元に戻すスクリプトがない。

マイグレーションはすべての`up()`に対して`down()`関数を与える。Synchronizeは何も与えない。

## 解決策：TypeORM CLI + `data-source.ts`

正しいアプローチはTypeORMのマイグレーションシステムを使用することだ：エンティティと現在のデータベーススキーマの差分をキャプチャするマイグレーションファイルを生成し、レビューし、コミットし、アプリに起動時に自動的に適用させる。

これを行うには、TypeORM CLIがインポートできるスタンドアロンの`data-source.ts`ファイルが必要だ。NestJSの依存性注入システムがこれを少し厄介にする——NestJS内のTypeORM接続はCLIから直接アクセスできない。スタンドアロンファイルがこれを解決する。

### `data-source.ts`のセットアップ

```typescript
// src/database/data-source.ts
import 'dotenv/config'
import { DataSource } from 'typeorm'
import { join } from 'path'

export const AppDataSource = new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT ?? '5432'),
  username: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  entities: [join(__dirname, '../**/*.entity{.ts,.js}')],
  migrations: [join(__dirname, '../migrations/*{.ts,.js}')],
  synchronize: false,
  migrationsRun: false,
})
```

このファイルはCLIでのみ使用される。先頭の`import 'dotenv/config'`は、CLIがNestJSアプリケーションコンテキスト外で実行されるときに環境変数がロードされることを保証する。

`package.json`にスクリプトを追加：

```json
{
  "scripts": {
    "migration:generate": "typeorm-ts-node-commonjs migration:generate -d src/database/data-source.ts",
    "migration:run": "typeorm-ts-node-commonjs migration:run -d src/database/data-source.ts",
    "migration:revert": "typeorm-ts-node-commonjs migration:revert -d src/database/data-source.ts",
    "migration:show": "typeorm-ts-node-commonjs migration:show -d src/database/data-source.ts"
  }
}
```

### マイグレーションの生成

エンティティを変更したら、マイグレーションを生成する：

```bash
npm run migration:generate -- src/migrations/AddContestDivisions
```

TypeORMはデータベースに接続し、現在のスキーマを読み、エンティティ定義と比較し、マイグレーションファイルを生成する。

生成されたファイルをレビューする。TypeORMの差分は通常正しいが常にではない——カラムの名前を変更した場合、`ALTER TABLE ... RENAME COLUMN`の代わりに`DROP`と`ADD`を生成するかもしれない。生成されたマイグレーションを実行する前に常に読む。

### アプリ起動時のマイグレーション実行

アプリケーション自体には、アプリ起動時に保留中のマイグレーションを自動的に実行するように`database.module.ts`を設定する：

```typescript
// src/database/database.module.ts
import { TypeOrmModule } from '@nestjs/typeorm'
import { ConfigService } from '@nestjs/config'

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        host: config.get('DB_HOST'),
        port: config.get<number>('DB_PORT'),
        username: config.get('DB_USER'),
        password: config.get('DB_PASSWORD'),
        database: config.get('DB_NAME'),
        entities: [__dirname + '/../**/*.entity{.ts,.js}'],
        migrations: [__dirname + '/../migrations/*{.ts,.js}'],
        synchronize: false,
        migrationsRun: true,  // ← 起動時に保留中のマイグレーションを実行
      }),
    }),
  ],
})
export class DatabaseModule {}
```

`migrationsRun: true`はTypeORMにアプリケーション起動時に未適用のマイグレーションファイルを順番に実行するよう指示する。TypeORMはデータベースの`migrations`テーブルでどのマイグレーションが適用されたかを追跡する。

## 開発 vs 本番ワークフロー

重要な洞察は`synchronize: true`は開発では問題ない——どうせ常にデータベースを捨てているし、スピードの利点は本物だ。問題は本番で実行すること。

条件付き設定が両方を処理する：

```typescript
synchronize: config.get('NODE_ENV') === 'development',
migrationsRun: config.get('NODE_ENV') !== 'development',
```

開発では：即座の同期、マイグレーションのオーバーヘッドなし。
ステージングと本番では：明示的なマイグレーション、完全な監査証跡。

ルール：**エンティティ変更をmainにマージする前にマイグレーションを生成する**。エンティティをローカルで変更してマイグレーションを生成しないと、ステージングデプロイメントが失敗する（または、さらに悪いことに、欠落しているカラムを使おうとしてアプリケーションがクラッシュしたときにスキーマ変更を静かにスキップする）。

対応するマイグレーションファイルなしでコミットされていないエンティティ変更をチェックする`precommit`フックがこれを自動的に強制できる。

## 命名規則とベストプラクティス

### マイグレーションファイルの命名

TypeORMはUnixタイムスタンププレフィックス付きでマイグレーションファイルを生成する。説明部分を意味のあるものに保つ：

```
1709900000000-AddContestDivisions.ts    ✅
1709900000000-UpdateSchema.ts           ❌ (曖昧すぎる)
1709900000000-Fix.ts                    ❌ (完全に無意味)
```

説明はログとmigrationsテーブルでマイグレーションファイル名の唯一の人間が読める部分だ。大切にする。

### マイグレーションごとに1つのスキーマ変更

複数のスキーマ変更を1つのマイグレーションファイルにバンドルする誘惑に抵抗する。各論理的変更は独自のファイルであるべきだ。これによりロールバックが外科的になる：`AddContestDivisions`が問題を引き起こしたら、3つの無関係な変更のバンドルではなく、そのマイグレーションだけを元に戻す。

### ロールバック戦略

TypeORMの`migration:revert`は最新のマイグレーションの`down()`関数を実行する。複数のマイグレーションをロールバックするには、複数回実行する。

常に`down()`関数を書く。TypeORMはこれを強制しないが、`down()`のないマイグレーションは後戻りできない操作だ。本番でロールバックが必要な1回が、まさに書いておけばよかったと思う1回だ。

本番で頼る前にステージング環境で`down()`をテストする。正しく見えるが実際のデータでは失敗する`down()`を書くのは簡単だ（例えば、`up()`がデフォルト付きのNOT NULLカラムを追加した場合、`down()`はそれをドロップする必要があるが、行レベルのデータが依存している場合、ロールバックは予期しない方法でカスケードするかもしれない）。

### デプロイ済みマイグレーションは編集しない

マイグレーションがステージングまたは本番に適用されたら、編集しない。`migrations`テーブルは適用されたマイグレーションをファイル名で追跡する。ファイルを変更しても、TypeORMは再実行しない（ファイル名はすでに適用済みとマークされている）、そして実際のデータベーススキーマはファイルが言っていることと乖離する。

デプロイ済みマイグレーションの間違いを修正する必要がある場合は、それを修正する新しいマイグレーションを作成する。

## 振り返り

マイグレーションシステムは摩擦を追加する——ファイルを生成し、レビューし、コミットし、エンティティ変更と一緒に保持する必要がある。その摩擦がポイントだ。スキーマ変更を意図的で可逆的にすることを強制する。

`synchronize: true`は素晴らしい開発ツールだ。本番では凶器だ。`data-source.ts`とマイグレーションスクリプトをセットアップするのにかかる2分は、ステージングへの最初のデプロイメントが正しく機能し、適用されたすべてのスキーマ変更の明確な記録があるとき、価値がある。

深夜2時のインシデント中にmigrationsテーブルを見ている将来の自分が感謝するだろう。
