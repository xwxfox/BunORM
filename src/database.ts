/**
 * bunorm/src/database.ts
 * Database connection manager — WAL mode, pragma tuning, migration/sync,
 * and the prepared-statement cache.
 */

import { Database, constants, type SQLQueryBindings } from "bun:sqlite";

// ─── Typed statement wrapper ──────────────────────────────────────────────────

/** Narrow re-export so callers don't need to import bun:sqlite themselves */
export type { SQLQueryBindings };

/** A prepared statement with strongly-typed param binding */
export interface BunStatement {
  run(...params: SQLQueryBindings[]): { changes: number; lastInsertRowid: number | bigint };
  all(...params: SQLQueryBindings[]): unknown[];
  get(...params: SQLQueryBindings[]): unknown;
  finalize(): void;
}

// ─── Pragma defaults ──────────────────────────────────────────────────────────

interface DatabaseOptions {
  /** Path to the SQLite file. Defaults to ":memory:" */
  path?: string;
  /**
   * Cache size in pages (each page is typically 4 KB).
   * Negative value = kilobytes. Defaults to -64000 (~64 MB).
   */
  cacheSize?: number;
  /**
   * Busy timeout in milliseconds while waiting for a write lock.
   * Defaults to 5000.
   */
  busyTimeout?: number;
  /**
   * PRAGMA synchronous level.
   * "OFF" | "NORMAL" | "FULL" | "EXTRA". Defaults to "NORMAL".
   * NORMAL is safe with WAL and gives the best perf/safety trade-off.
   */
  synchronous?: "OFF" | "NORMAL" | "FULL" | "EXTRA";
  /** PRAGMA mmap_size in bytes. 0 disables. Defaults to 256 MB. */
  mmapSize?: number;
}

// ─── BunORM Database ──────────────────────────────────────────────────────────

export class BunDatabase {
  readonly db: Database;

  constructor(opts: DatabaseOptions = {}) {
    const path = opts.path ?? ":memory:";
    this.db = new Database(path, { create: true });

    // WAL mode — must be set before anything else
    this.db.run("PRAGMA journal_mode = WAL;");

    // Performance + safety pragmas
    const sync = opts.synchronous ?? "NORMAL";
    const cache = opts.cacheSize ?? -64000;
    const busy = opts.busyTimeout ?? 5000;
    const mmap = opts.mmapSize ?? 268435456; // 256 MB

    this.db.run(`PRAGMA synchronous = ${sync};`);
    this.db.run(`PRAGMA cache_size = ${cache};`);
    this.db.run(`PRAGMA busy_timeout = ${busy};`);
    this.db.run(`PRAGMA mmap_size = ${mmap};`);
    this.db.run("PRAGMA foreign_keys = ON;");
    this.db.run("PRAGMA temp_store = MEMORY;");
  }

  /** Execute DDL statements — typically table CREATE and index CREATE */
  exec(sql: string): void {
    this.db.run(sql);
  }

  /** Run a block inside a BEGIN / COMMIT transaction */
  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }

  /**
   * Cleanly close the database.
   * Disables WAL persistence so no -wal/-shm sidecar files are left behind
   * (important on macOS / cross-platform deploys).
   */
  close(): void {
    try {
      this.db.fileControl(constants.SQLITE_FCNTL_PERSIST_WAL, 0);
      this.db.run("PRAGMA wal_checkpoint(TRUNCATE);");
    } catch {
      // Best-effort — ignore if already closed or in-memory
    }
    this.db.close();
  }

  /**
   * Prepared statement cache — keyed by the SQL string.
   * Statements are compiled once and reused, which is the primary
   * performance win over naïve query execution.
   */
  private readonly _stmtCache = new Map<string, BunStatement>();

  prepare(sql: string): BunStatement {
    let stmt = this._stmtCache.get(sql);
    if (!stmt) {
      stmt = this.db.prepare(sql);
      this._stmtCache.set(sql, stmt);
    }
    return stmt as BunStatement;
  }

  /** Clear the statement cache (e.g. after schema changes) */
  clearCache(): void {
    this._stmtCache.clear();
  }
}

import { existsSync, unlinkSync } from "node:fs";

export function resolveDbFilePaths(path: string): string[] {
  if (path === ":memory:") return [];
  return [
    path,
    `${path}-wal`,
    `${path}-shm`,
    `${path}-journal`,
  ].filter((p) => existsSync(p));
}

export function unlinkDbFiles(path: string): void {
  for (const p of resolveDbFilePaths(path)) {
    try {
      unlinkSync(p);
    } catch {
      // best-effort
    }
  }
}
