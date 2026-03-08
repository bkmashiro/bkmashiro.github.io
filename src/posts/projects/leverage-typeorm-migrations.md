---
title: "TypeORM Migrations in Production: From synchronize:true to Proper Migrations"
description: "Why synchronize:true will eventually destroy your production database, and how to set up a TypeORM migrations workflow that's actually safe — with a separate data-source.ts, conditional config, and a rollback strategy."
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

There's a setting in TypeORM that every developer uses in development and every developer who has run it in production regrets:

```typescript
synchronize: true
```

When you set `synchronize: true`, TypeORM compares your entity definitions against the database schema on startup and automatically applies the diff. It's magic. It's instant. It means you never have to think about migrations during development. Add a column to your entity, restart the server, the column exists.

The reason you don't run this in production is that it works the same way in reverse.

## The Problem with `synchronize: true`

### TypeORM Will Drop Columns

If you delete a column from your entity definition, TypeORM will issue a `DROP COLUMN` when the app starts. No warning, no prompt, no backup. If that column had data in it — months of user records, audit logs, configuration — it's gone.

This happens in development all the time without consequence because development data is disposable. In production, it's a data loss incident.

### It Runs on Every Startup

With `synchronize: true`, every time the app starts — every deployment, every restart after a crash, every container that comes up in your Kubernetes pod — TypeORM runs the full sync. If two containers start simultaneously and both try to alter the same table, you can get locking issues or race conditions.

In a standard single-server deployment this is usually fine. In any kind of cluster or rolling deployment, it's a time bomb.

### It Can't Be Rolled Back

`synchronize: true` doesn't generate migration files. There's no record of what changed. If the sync breaks something — say, TypeORM decides your column type changed and does an implicit alter that corrupts data — you have no script to undo it.

Migrations give you a `down()` function for every `up()`. Synchronize gives you nothing.

## The Solution: TypeORM CLI + `data-source.ts`

The right approach is to use TypeORM's migration system: generate a migration file that captures the diff between your entities and the current database schema, review it, commit it, and let the app apply it automatically on startup.

To do this, you need a standalone `data-source.ts` file that the TypeORM CLI can import. NestJS's dependency injection system makes this slightly awkward — the TypeORM connection inside NestJS isn't directly accessible to the CLI. The standalone file solves this.

### Setting Up `data-source.ts`

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

This file is used exclusively by the CLI. The `import 'dotenv/config'` at the top ensures the environment variables are loaded when the CLI runs outside of the NestJS application context.

Add scripts to `package.json`:

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

### Generating a Migration

When you modify your entities, generate a migration:

```bash
npm run migration:generate -- src/migrations/AddContestDivisions
```

TypeORM connects to the database, reads the current schema, compares it against your entity definitions, and generates a migration file:

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

Review the generated file. TypeORM's diff is usually correct but not always — if you renamed a column, it might generate a `DROP` and `ADD` instead of an `ALTER TABLE ... RENAME COLUMN`. Always read the generated migration before running it.

### Running Migrations on App Startup

For the application itself, configure `database.module.ts` to run pending migrations automatically when the app starts:

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
        migrationsRun: true,  // ← runs pending migrations on startup
      }),
    }),
  ],
})
export class DatabaseModule {}
```

`migrationsRun: true` tells TypeORM to run any unapplied migration files when the application starts, in order. TypeORM tracks which migrations have been applied in a `migrations` table in your database.

## Development vs Production Workflow

The key insight is that `synchronize: true` is fine in development — you're throwing away the database constantly anyway, and the speed benefit is real. The problem is running it in production.

A conditional configuration handles both:

```typescript
synchronize: config.get('NODE_ENV') === 'development',
migrationsRun: config.get('NODE_ENV') !== 'development',
```

In development: instant sync, no migration overhead.
In staging and production: explicit migrations, full audit trail.

The rule: **generate a migration before merging any entity change to main**. If you modify an entity locally but don't generate a migration, the staging deployment will fail (or, worse, silently skip the schema change and have your application crash when it tries to use the missing column).

A `precommit` hook that checks for uncommitted entity changes without corresponding migration files can enforce this automatically.

## Naming Conventions and Best Practices

### Migration File Naming

TypeORM generates migration files with a Unix timestamp prefix. Keep the description part meaningful:

```
1709900000000-AddContestDivisions.ts    ✅
1709900000000-UpdateSchema.ts           ❌ (too vague)
1709900000000-Fix.ts                    ❌ (completely useless)
```

The description is the only human-readable part of the migration filename in logs and the migrations table. Make it count.

### One Schema Change per Migration

Resist the urge to bundle multiple schema changes into one migration file. Each logical change should be its own file. This makes rollbacks surgical: if `AddContestDivisions` causes a problem, you revert just that migration, not a bundle of three unrelated changes.

### Rollback Strategy

TypeORM's `migration:revert` runs the most recent migration's `down()` function. To roll back multiple migrations, run it multiple times.

Always write `down()` functions. TypeORM doesn't enforce this, but migrations without a `down()` are point-of-no-return operations. The one time you need to roll back in production is exactly the one time you'll wish you'd written it.

```typescript
public async down(queryRunner: QueryRunner): Promise<void> {
  // Must be the exact inverse of up()
  // Test this locally before deploying
}
```

Test your `down()` in a staging environment before relying on it. It's easy to write a `down()` that looks correct but fails on real data (for example, if `up()` added a NOT NULL column with a default, `down()` needs to drop it, but if any row-level data depends on it, the rollback might cascade in unexpected ways).

### Never Edit a Deployed Migration

Once a migration has been applied to staging or production, don't edit it. The `migrations` table tracks applied migrations by filename. If you change the file, TypeORM won't re-run it (the filename is already marked as applied), and the actual database schema will diverge from what the file says.

If you need to fix a mistake in a deployed migration, create a new migration that corrects it.

## Retrospective

The migration system adds friction — you have to generate a file, review it, commit it, and keep it alongside your entity changes. That friction is the point. It forces you to make the schema change intentional and reversible.

`synchronize: true` is a great development tool. It's a production footgun. The two minutes it takes to set up `data-source.ts` and the migration scripts is worth it when your first deployment to staging works correctly and you have a clear record of every schema change that's ever been applied.

Your future self, looking at the migrations table at 2 AM during an incident, will thank you.
