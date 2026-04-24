# Part 2: Inspect + Diff + Migrate + Sync — Implementation Plan

> **Status:** Planning  
> **Goal:** Full migration system with schema inspection, diff detection, Prisma-style migration files, and configurable sync policies.

---

## Architecture Decisions

| Decision | Choice |
|----------|--------|
| **Migration format** | `.ts` files in a configurable directory (default `./migrations`) |
| **Migration structure** | Named exports: `up(db)`, optional `down(db)`, `name`, `date` |
| **Migration tracking** | `_bunorm_migrations` table with `name` (PK) and `appliedAt` |
| **Migration discovery** | Only scans directory if `migrations` option is passed to `createORM()` |
| **Rollback (`down`)** | **Not in current scope** — but API shape supports it for future implementation |
| **Schema diff** | Compare `TableMeta[]` (desired) with `InspectorResult[]` (actual) |
| **Auto-apply safe changes** | Add nullable columns, add indexes, add tables/sub-tables |
| **Blocked changes** | Drop column, rename column, change type, change PK, drop table, add required column without default |
| **Sync policies** | `"ignore"` (default), `"warn"`, `"error"`, `"auto"`, custom callback |
| **Old schema access** | Deserialize from `_bunorm_meta._schema_compressed` — no user action required |

---

## Why Prisma-Style `.ts` Migrations?

| Benefit | Explanation |
|---------|-------------|
| **Type safety** | Migration files are TypeScript — LSP catches errors, no raw SQL typos |
| **Version control** | Each migration is a committed file with a clear name and date |
| **Incremental** | Only unapplied migrations run; safe to re-run `createORM()` |
| **Audit trail** | `_bunorm_migrations` table records exactly what ran and when |
| **Arbitrary logic** | Migrations can do more than DDL — data transforms, backfills, etc. |

---

## Files to Create

### `src/inspector.ts` — Schema Inspector

Responsibilities:
- Query SQLite's actual schema via `PRAGMA` and `sqlite_master`
- Return structured `InspectorResult` for each table

```ts
export interface InspectorColumn {
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
  pk: number;
}

export interface InspectorIndex {
  name: string;
  unique: number;
  columns: string[];
}

export interface InspectorTable {
  name: string;
  columns: InspectorColumn[];
  indexes: InspectorIndex[];
}

export function inspectSchema(db: BunDatabase, tableName: string): InspectorTable;
export function inspectAllTables(db: BunDatabase): InspectorTable[];
```

### `src/diff.ts` — Schema Diff Engine

Responsibilities:
- Compare `TableMeta[]` (desired, from TypeBox schemas) with `InspectorTable[]` (actual, from SQLite)
- Produce `SchemaDiff` with `safe[]` and `unsafe[]` changes

```ts
export type SchemaChange =
  | { kind: "add-table"; table: string }
  | { kind: "add-column"; table: string; column: ColumnMeta; hasDefault: boolean }
  | { kind: "add-index"; table: string; index: IndexMeta }
  | { kind: "add-subtable"; table: string; subTable: SubTableMeta }
  | { kind: "drop-column"; table: string; column: string }
  | { kind: "rename-column"; table: string; from: string; to: string }
  | { kind: "change-type"; table: string; column: string; from: string; to: string }
  | { kind: "change-nullable"; table: string; column: string; to: boolean }
  | { kind: "drop-table"; table: string }
  | { kind: "change-pk"; table: string };

export interface SchemaDiff {
  safe: SchemaChange[];
  unsafe: SchemaChange[];
}

export function computeDiff(
  desired: TableMeta[],
  actual: InspectorTable[]
): SchemaDiff;
```

### `src/sync.ts` — Sync Policy Engine

Responsibilities:
- Apply `safe` changes automatically
- Throw or warn on `unsafe` changes based on policy

```ts
export type SyncPolicy =
  | "ignore"
  | "warn"
  | "error"
  | "auto"
  | ((diff: SchemaDiff, db: BunDatabase) => boolean | void);

export function applySync(
  diff: SchemaDiff,
  db: BunDatabase,
  policy: SyncPolicy
): void;
```

### `src/migrate.ts` — Migration Runner

Responsibilities:
- Scan `migrationsDir` for `.ts` files
- Filter to unapplied migrations (via `_bunorm_migrations` table)
- Run `up()` in order inside a transaction
- Record applied migrations

```ts
export interface Migration {
  name: string;
  date: string; // ISO 8601
  up: (db: BunDatabase) => void;
  down?: (db: BunDatabase) => void;
}

export interface MigrateOptions {
  path: string;
  migrationsDir: string;
  direction?: "up";
  target?: string; // run up to and including this migration
}

export async function migrate(opts: MigrateOptions): Promise<void>;
```

### `src/migration-template.ts` — Migration File Generator

Responsibilities:
- `createMigration(name, dir)` generates a new `.ts` file with boilerplate

```ts
export function createMigration(name: string, migrationsDir: string): string;
// Returns the path to the created file
```

---

## Files to Modify

### `src/orm.ts` — Add `sync` and `migrations` Options

```ts
export interface CreateORMOptions<...> extends CreateORMBaseOptions {
  tables: T;
  relations?: ...;
  sync?: SyncPolicy;           // NEW
  migrations?: {               // NEW — only looked at if present
    dir: string;
    autoRun?: boolean;         // run pending migrations on createORM() — default true
  };
}
```

**Boot sequence with `sync` and `migrations`:**
1. Open DB, set pragmas
2. Read `_bunorm_meta` (if exists)
3. If `migrations` option present:
   - Create `_bunorm_migrations` table
   - Scan `migrationsDir`
   - Run unapplied migrations in order (if `autoRun: true`)
4. Compare current schema with stored schema hash:
   - If match → continue
   - If mismatch → run `inspectSchema` + `computeDiff` + `applySync`
5. Write updated metadata

### `src/types.ts` — Add Migration Types

```ts
export interface Migration {
  name: string;
  date: string;
  up: (db: BunDatabase) => void;
  down?: (db: BunDatabase) => void;
}
```

### `src/index.ts` — Export New Symbols

```ts
export { inspectSchema, inspectAllTables } from "./inspector.ts";
export { computeDiff } from "./diff.ts";
export { migrate, createMigration } from "./migrate.ts";
export type { Migration, MigrateOptions, SchemaDiff, SchemaChange } from "./types.ts";
```

---

## API Surface

### Sync Policy

```ts
// Default — no checks, CREATE IF NOT EXISTS only
const orm = createORM({ tables: { ... } });

// Warn on drift
const orm = createORM({ tables: { ... }, sync: "warn" });

// Throw on drift
const orm = createORM({ tables: { ... }, sync: "error" });

// Auto-apply safe changes, throw on unsafe
const orm = createORM({ tables: { ... }, sync: "auto" });

// Custom handler
const orm = createORM({
  tables: { ... },
  sync: (diff) => {
    console.log("Unsafe changes:", diff.unsafe);
    if (diff.unsafe.some((c) => c.kind === "drop-column")) {
      throw new Error("Dropping columns is not allowed in this environment");
    }
  },
});
```

### Migration Files

```ts
// migrations/20250601_add_customer_email.ts
import type { Migration } from "bunorm";

export default {
  name: "add_customer_email",
  date: "2025-06-01T00:00:00Z",

  up(db) {
    db.exec(`ALTER TABLE "customers" ADD COLUMN "email" TEXT`);
    db.exec(`UPDATE "customers" SET "email" = 'unknown@example.com'`);
  },
} satisfies Migration;
```

### Migration Runner

```ts
import { migrate, createMigration } from "bunorm";

// Generate new migration file
const path = createMigration("add_customer_email", "./migrations");
// → creates ./migrations/20250601_add_customer_email.ts

// Run pending migrations
await migrate({
  path: "shop.db",
  migrationsDir: "./migrations",
});
```

### Schema Inspection

```ts
import { inspectSchema } from "bunorm";

const info = inspectSchema(db, "sales");
console.log(info.columns);
// [{ name: "id", type: "TEXT", notnull: 1, pk: 1 }, ...]
```

---

## Migration Tracking Table

```sql
CREATE TABLE IF NOT EXISTS "_bunorm_migrations" (
  "name" TEXT PRIMARY KEY,
  "appliedAt" INTEGER NOT NULL
);
```

---

## Change Classification

| Change | Classification | Auto-apply? | Notes |
|--------|---------------|-------------|-------|
| Add table | Safe | ✅ Yes | `CREATE TABLE` |
| Add sub-table | Safe | ✅ Yes | `CREATE TABLE` for sub-table |
| Add nullable column | Safe | ✅ Yes | `ALTER TABLE ... ADD COLUMN` |
| Add required column with default | Safe | ✅ Yes | `ALTER TABLE ... ADD COLUMN ... DEFAULT` |
| Add required column without default | Unsafe | ❌ No | Needs migration to populate existing rows |
| Add index | Safe | ✅ Yes | `CREATE INDEX` |
| Drop column | Unsafe | ❌ No | Data loss — user must define migration |
| Rename column | Unsafe | ❌ No | SQLite doesn't support `RENAME COLUMN` natively in all versions |
| Change column type | Unsafe | ❌ No | Needs type coercion / transform |
| Change nullable → not null | Unsafe | ❌ No | Needs default for existing nulls |
| Change not null → nullable | Safe | ✅ Yes | `ALTER TABLE` |
| Change PK | Unsafe | ❌ No | Requires table rebuild |
| Drop table | Unsafe | ❌ No | Data loss |

---

## Future-Proofing for Rollbacks (`down`)

The `Migration` interface already includes an optional `down` function:

```ts
export interface Migration {
  name: string;
  date: string;
  up: (db: BunDatabase) => void;
  down?: (db: BunDatabase) => void; // reserved for future
}
```

This means:
- Migration files can already include `down`
- `_bunorm_migrations` table can support rollback tracking later
- `migrate({ direction: "down" })` can be added without breaking existing files

**Why not implement now:**
- Rollbacks in SQLite are complex (no `DROP COLUMN`, type changes need temp tables)
- Most teams avoid rollbacks in production; they prefer forward-fix migrations
- Keeps Part 2 scope manageable

---

## Execution Order

| Step | File | Action |
|------|------|--------|
| 1 | `src/inspector.ts` | Create schema inspector |
| 2 | `src/diff.ts` | Create diff engine |
| 3 | `src/sync.ts` | Create sync policy engine |
| 4 | `src/migrate.ts` | Create migration runner |
| 5 | `src/migration-template.ts` | Create migration file generator |
| 6 | `src/types.ts` | Add `Migration`, `SchemaDiff`, `SchemaChange` types |
| 7 | `src/orm.ts` | Add `sync` and `migrations` options; integrate boot sequence |
| 8 | `src/index.ts` | Export new symbols |
| 9 | `tests/migrate.test.ts` | Test migration runner |
| 10 | `tests/diff.test.ts` | Test diff engine |

---

## Open Questions (for Part 2 build)

1. **Migration file naming:** `YYYYMMDD_name.ts` or `timestamp_name.ts`? Prisma uses timestamps; Rails uses dates. I recommend `YYYYMMDD_HHMMSS_name.ts` for sortability and uniqueness.

2. **`autoRun` default:** Should migrations auto-run on `createORM()` by default? Prisma does not — you run `prisma migrate deploy` separately. I recommend `autoRun: false` by default, with a separate `orm.migrate()` method for explicit control.

3. **Migration ordering:** File name lexicographic sort is simple and works. Alternative: read `date` field from each file and sort by that. File name sort is more robust (no import needed just to check order).

4. **Down migrations in SQLite:** Since SQLite lacks `DROP COLUMN` in older versions, a `down` that drops a column would need to:
   - Create temp table without the column
   - Copy data
   - Drop old table
   - Rename temp table
   - Re-create indexes
   
   This is error-prone. For now, `down` is documented but not executed.

---

## Depends On

Part 2 depends on Part 1's `_bunorm_meta` table:
- `_schema_compressed` is deserialized to get the old schema for diffing
- `_schema_hash` is used for a fast "has anything changed?" check
- `_tables` and `_relations` tell us what existed before

Without Part 1, the diff engine would have no baseline to compare against.
