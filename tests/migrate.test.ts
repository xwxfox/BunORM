/**
 * bunorm/tests/migrate.test.ts
 * Tests for migration file generation and runner.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createORM, createMigration, migrate, table } from "../src/index.ts";
import { BunDatabase } from "../src/database.ts";
import { Object, String, Integer } from "typebox";

const UserSchema = Object({
  id: String(),
  name: String(),
});

const tmpDir = join(import.meta.dir, "__tmp_migrations");

describe("createMigration", () => {
  beforeEach(() => {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true });
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true });
  });

  test("creates a migration file with boilerplate", async () => {
    const path = createMigration("add_users_table", tmpDir);
    expect(existsSync(path)).toBe(true);
    expect(path.endsWith(".ts")).toBe(true);

    const text = await Bun.file(path).text();
    expect(text).toContain('name: "add_users_table"');
    expect(text).toContain("up(db)");
    expect(text).toContain("satisfies Migration");
  });
});

describe("migrate runner", () => {
  const dbPath = join(tmpDir, "test.db");

  beforeEach(() => {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true });
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true });
  });

  test("applies unapplied migrations in order", async () => {
    const mig1 = join(tmpDir, "20250101_000001_add_email.ts");
    writeFileSync(
      mig1,
      `export default {
        name: "add_email",
        date: "2025-01-01T00:00:00Z",
        up(db) {
          db.exec('CREATE TABLE IF NOT EXISTS "test_mig" ("id" TEXT PRIMARY KEY, "email" TEXT)');
        },
      };`
    );

    const mig2 = join(tmpDir, "20250101_000002_add_index.ts");
    writeFileSync(
      mig2,
      `export default {
        name: "add_index",
        date: "2025-01-01T00:00:01Z",
        up(db) {
          db.exec('CREATE INDEX IF NOT EXISTS "idx_email" ON "test_mig" ("email")');
        },
      };`
    );

    await migrate({ path: dbPath, migrationsDir: tmpDir });

    // Verify migration tracking table
    const orm = createORM({
      path: dbPath,
      tables: {
        users: table(UserSchema, (s) => ({ primaryKey: s.id })),
      },
    });

    const checkDb = new BunDatabase({ path: dbPath });
    const applied = checkDb.prepare('SELECT "name" FROM "_bunorm_migrations" ORDER BY "name"').all() as Array<{ name: string }>;
    checkDb.close();

    expect(applied).toHaveLength(2);
    expect(applied[0]!.name).toBe("20250101_000001_add_email");
    expect(applied[1]!.name).toBe("20250101_000002_add_index");

    orm.close();
  });

  test("skips already applied migrations", async () => {
    const mig1 = join(tmpDir, "20250101_000001_add_email.ts");
    writeFileSync(
      mig1,
      `export default {
        name: "add_email",
        date: "2025-01-01T00:00:00Z",
        up(db) {
          db.exec('CREATE TABLE IF NOT EXISTS "test_mig" ("id" TEXT PRIMARY KEY, "email" TEXT)');
        },
      };`
    );

    await migrate({ path: dbPath, migrationsDir: tmpDir });
    await migrate({ path: dbPath, migrationsDir: tmpDir });

    const orm = createORM({
      path: dbPath,
      tables: {
        users: table(UserSchema, (s) => ({ primaryKey: s.id })),
      },
    });

    const checkDb = new BunDatabase({ path: dbPath });
    const applied = checkDb.prepare('SELECT "name" FROM "_bunorm_migrations" ORDER BY "name"').all() as Array<{ name: string }>;
    checkDb.close();

    expect(applied).toHaveLength(1);
    orm.close();
  });

  test("orm.migrate() calls runner with configured dir", async () => {
    const mig1 = join(tmpDir, "20250101_000001_add_email.ts");
    writeFileSync(
      mig1,
      `export default {
        name: "add_email",
        date: "2025-01-01T00:00:00Z",
        up(db) {
          db.exec('CREATE TABLE IF NOT EXISTS "test_mig" ("id" TEXT PRIMARY KEY, "email" TEXT)');
        },
      };`
    );

    const orm = createORM({
      path: dbPath,
      tables: {
        users: table(UserSchema, (s) => ({ primaryKey: s.id })),
      },
      migrations: { dir: tmpDir },
    });

    await orm.migrate();

    const checkDb = new BunDatabase({ path: dbPath });
    const applied = checkDb.prepare('SELECT "name" FROM "_bunorm_migrations" ORDER BY "name"').all() as Array<{ name: string }>;
    checkDb.close();

    expect(applied).toHaveLength(1);
    orm.close();
  });
});
