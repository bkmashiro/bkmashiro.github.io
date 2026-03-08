---
title: "TypeORM Migrations 实战：从 synchronize:true 到正经的数据库迁移"
description: "为什么 synchronize:true 迟早会毁掉你的生产数据库，以及如何用独立的 data-source.ts、条件配置和回滚策略搭建一套真正安全的 TypeORM 迁移工作流。"
date: 2026-03-08
readingTime: true
tag:
  - TypeORM
  - NestJS
  - Database
  - PostgreSQL
  - Backend
outline: [2, 3]
---

TypeORM 有一个配置项，每个开发者在开发环境用了都觉得好，每个在生产环境跑过的人都后悔了：

```typescript
synchronize: true
```

设置 `synchronize: true` 后，TypeORM 在启动时会对比你的 entity 定义和数据库 schema，自动应用差异。很魔法，即时生效，开发期间完全不用考虑迁移。给 entity 加个字段，重启服务器，字段就在了。

不在生产环境跑它的原因是：反过来它也一样。

## `synchronize: true` 的问题

### TypeORM 会删列

如果你从 entity 定义里删掉一个字段，TypeORM 启动时会执行 `DROP COLUMN`。没有警告，没有确认，没有备份。如果那一列里有数据——几个月的用户记录、审计日志、配置信息——就这么没了。

开发环境里这种事天天发生，没有任何后果，因为开发数据是可抛弃的。生产环境里，这是一次数据丢失事故。

### 每次启动都会运行

有了 `synchronize: true`，每次应用启动——每次部署、每次崩溃后重启、每个在 Kubernetes pod 里起来的容器——TypeORM 都会跑一次完整的同步。如果两个容器同时启动，都试图修改同一张表，可能会遇到锁问题或竞态条件。

单服务器部署通常没事。任何形式的集群部署或滚动发布，这就是个定时炸弹。

### 无法回滚

`synchronize: true` 不生成迁移文件。没有变更记录。如果同步出了问题——比如 TypeORM 判断你的列类型改变了，做了一次隐式 ALTER 损坏了数据——你没有任何脚本可以撤销它。

Migration 系统每个 `up()` 都有对应的 `down()` 函数。Synchronize 什么都没有。

## 解决方案：TypeORM CLI + `data-source.ts`

正确的做法是使用 TypeORM 的迁移系统：生成一个迁移文件，记录 entity 和当前数据库 schema 之间的差异，检查它，提交它，让应用在启动时自动执行它。

为此，你需要一个独立的 `data-source.ts` 文件，供 TypeORM CLI 导入。NestJS 的依赖注入系统让这稍微有些别扭——NestJS 内部的 TypeORM 连接无法直接被 CLI 访问。这个独立文件就是解决办法。

### 配置 `data-source.ts`

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

这个文件只供 CLI 使用。顶部的 `import 'dotenv/config'` 确保在 NestJS 应用上下文之外运行 CLI 时，环境变量也能正确加载。

在 `package.json` 里加上脚本：

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

### 生成迁移文件

修改 entity 之后，生成迁移：

```bash
npm run migration:generate -- src/migrations/AddContestDivisions
```

TypeORM 连接数据库，读取当前 schema，与你的 entity 定义对比，生成迁移文件：

```typescript
// src/migrations/1709900000000-AddContestDivisions.ts
import { MigrationInterface, QueryRunner } from 'typeorm'

export class AddContestDivisions1709900000000 implements MigrationInterface {
  name = 'AddContestDivisions1709900000000'

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "contest" ADD "divisions" jsonb NOT NULL DEFAULT '[]'`
    )
    await queryRunner.query(
      `CREATE INDEX "IDX_contest_divisions" ON "contest" ("divisions")`
    )
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_contest_divisions"`)
    await queryRunner.query(`ALTER TABLE "contest" DROP COLUMN "divisions"`)
  }
}
```

要检查生成的文件。TypeORM 的 diff 通常是对的，但不是百分之百——如果你重命名了一列，它可能生成 `DROP` + `ADD` 而不是 `ALTER TABLE ... RENAME COLUMN`。执行前一定要亲自读一遍生成的迁移文件。

### 应用启动时自动执行迁移

对于应用本身，配置 `database.module.ts`，让应用启动时自动执行待处理的迁移：

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
        migrationsRun: true,  // ← 启动时执行待处理的迁移
      }),
    }),
  ],
})
export class DatabaseModule {}
```

`migrationsRun: true` 告诉 TypeORM 在应用启动时按顺序执行所有未应用的迁移文件。TypeORM 在数据库里的 `migrations` 表中追踪哪些迁移已经执行过。

## 开发 vs 生产工作流

核心思路是：`synchronize: true` 在开发环境没问题——你反正一直在重建数据库，速度优势是真实的。问题是在生产环境跑它。

条件配置同时处理两种情况：

```typescript
synchronize: config.get('NODE_ENV') === 'development',
migrationsRun: config.get('NODE_ENV') !== 'development',
```

开发环境：即时同步，没有迁移开销。
Staging 和生产：显式迁移，完整的审计日志。

规则：**合并任何 entity 变更到 main 之前，先生成迁移文件**。如果你在本地修改了 entity 但没有生成迁移，staging 部署会失败（或者更糟，悄悄跳过 schema 变更，然后应用在尝试使用缺失列时崩溃）。

可以加一个 `precommit` hook，检查是否有未提交的 entity 变更而没有对应的迁移文件，来自动强制执行这条规则。

## 命名规范和最佳实践

### 迁移文件命名

TypeORM 生成的迁移文件带 Unix 时间戳前缀。描述部分要有意义：

```
1709900000000-AddContestDivisions.ts    ✅
1709900000000-UpdateSchema.ts           ❌（太模糊）
1709900000000-Fix.ts                    ❌（完全没用）
```

描述是迁移文件名在日志和 migrations 表里唯一人类可读的部分。写清楚。

### 一次 Schema 变更一个迁移文件

不要把多个 schema 变更打包进一个迁移文件。每个逻辑变更应该是自己单独的文件。这样回滚是外科手术式的：如果 `AddContestDivisions` 出了问题，只回滚那一个迁移，而不是三个无关变更捆绑在一起。

### 回滚策略

TypeORM 的 `migration:revert` 会执行最近一条迁移的 `down()` 函数。要回滚多条迁移，就多执行几次。

**一定要写 `down()` 函数。** TypeORM 不强制要求，但没有 `down()` 的迁移是单程票。需要在生产回滚的那一次，恰好是你最希望自己当初写了 `down()` 的时候。

```typescript
public async down(queryRunner: QueryRunner): Promise<void> {
  // 必须是 up() 的精确逆操作
  // 上线前在本地测试
}
```

上线前在 staging 环境测试你的 `down()` 函数。写出来看起来正确的 `down()` 很容易在真实数据上失败（比如，如果 `up()` 加了一列带默认值的 NOT NULL 列，`down()` 需要删它，但如果有任何行级数据依赖它，回滚可能会产生意外的级联效果）。

### 永远不要编辑已部署的迁移文件

一旦迁移被应用到 staging 或生产，就不要再编辑它。`migrations` 表按文件名追踪已应用的迁移。如果你改了文件，TypeORM 不会重新执行它（文件名已经被标记为已应用），而实际数据库 schema 会和文件内容产生偏差。

如果需要修复已部署迁移里的错误，创建一个新的迁移来修正它。

## 回顾

迁移系统增加了摩擦——你必须生成文件、检查它、提交它，并让它和 entity 变更一起存在。这个摩擦正是它的意义所在。它迫使你让 schema 变更变得有意识且可回滚。

`synchronize: true` 是很好的开发工具。它是生产环境的炸弹。配置 `data-source.ts` 和迁移脚本花两分钟，当你第一次部署到 staging 能正常工作，并且有每次 schema 变更的清晰记录时，这两分钟是值得的。

凌晨两点处理线上事故时盯着 migrations 表的未来的你，会感谢现在的你。
