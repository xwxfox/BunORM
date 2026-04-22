/**
 * bunorm/src/repository.ts
 * Typed repository for a single table — insert, find, update, delete,
 * upsert, paginate, count, and sub-table hydration.
 * Zero runtime casts; all types are inferred from the TObject schema.
 */

import { Compile } from "typebox/compile";
import type { TObject, TProperties } from "typebox";
import type {
  Infer,
  ScalarKeys,
  FindOptions,
  InsertData,
  UpdateData,
  UpsertOptions,
  PageResult,
  WhereClause,
  TableConfig,
} from "./types.ts";
import type { BunDatabase, SQLQueryBindings } from "./database.ts";
import {
  introspectTable,
  buildCreateTableSQL,
  buildIndexSQL,
  flattenRow,
  flattenSubRows,
  hydrateRow,
  type TableMeta,
} from "./schema.ts";
import {
  buildSelect,
  buildInsert,
  buildUpsert,
  buildUpdate,
  buildDelete,
  buildWhere,
} from "./query-builder.ts";

// ─── Repository ───────────────────────────────────────────────────────────────

export class Repository<
  T extends TObject,
  PK extends ScalarKeys<T>
> {
  readonly tableName: string;
  readonly meta: TableMeta;

  /** Compiled validator — JIT-accelerated schema check + Parse */
  private readonly validator: ReturnType<typeof Compile<T>>;

  private readonly db: BunDatabase;
  private readonly descriptor: TableConfig<T, PK>;

  constructor(
    tableName: string,
    config: TableConfig<T, PK>,
    db: BunDatabase
  ) {
    this.tableName = tableName;
    this.descriptor = config;
    this.db = db;
    this.meta = introspectTable(tableName, config.schema);

    // Compile schema once — reused for every validate/parse call
    this.validator = Compile(config.schema);

    // Create tables + indexes
    this._migrate();
  }

  // ─── Migration ─────────────────────────────────────────────────────────────

  private _migrate(): void {
    const pk = this.descriptor.primaryKey as string;
    const stmts = buildCreateTableSQL(this.meta, pk);
    this.db.transaction(() => {
      for (const sql of stmts) this.db.exec(sql);

      for (const idx of this.descriptor.indexes ?? []) {
        this.db.exec(
          buildIndexSQL(
            this.tableName,
            idx.columns as string[],
            idx.unique ?? false,
            idx.name
          )
        );
      }
    });
    this.db.clearCache();
  }

  // ─── Validation ────────────────────────────────────────────────────────────

  /** Validate + coerce via TypeBox Validator.Parse — throws on invalid data */
  parse(data: unknown): Infer<T> {
    return this.validator.Parse(data) as Infer<T>;
  }

  /** Type-guard only — no throw */
  check(data: unknown): data is Infer<T> {
    return this.validator.Check(data);
  }

  // ─── Insert ────────────────────────────────────────────────────────────────

  insert(data: InsertData<T>): Infer<T> {
    const parsed = this.parse(data);
    const obj = parsed as Record<string, unknown>;

    this.db.transaction(() => {
      // Main row
      const flat = flattenRow(obj, this.meta);
      const { sql, params } = buildInsert(this.tableName, flat);
      this.db.prepare(sql).run(...(params as SQLQueryBindings[]));

      const pkVal = obj[this.descriptor.primaryKey as string];

      // Sub-table rows
      for (const sub of this.meta.subTables) {
        const items = obj[sub.fieldName];
        if (!globalThis.Array.isArray(items) || items.length === 0) continue;
        const rows = flattenSubRows(pkVal as string | number, items, sub);
        for (const row of rows) {
          const { sql: iSql, params: iParams } = buildInsert(sub.tableName, row);
          this.db.prepare(iSql).run(...(iParams as SQLQueryBindings[]));
        }
      }
    });

    return parsed;
  }

  /** Insert many records in a single transaction */
  insertMany(records: InsertData<T>[]): Infer<T>[] {
    const parsed = records.map((r) => this.parse(r));
    this.db.transaction(() => {
      for (const p of parsed) this._insertParsed(p as Record<string, unknown>);
    });
    return parsed;
  }

  private _insertParsed(obj: Record<string, unknown>): void {
    const flat = flattenRow(obj, this.meta);
    const { sql, params } = buildInsert(this.tableName, flat);
    this.db.prepare(sql).run(...(params as SQLQueryBindings[]));
    const pkVal = obj[this.descriptor.primaryKey as string];
    for (const sub of this.meta.subTables) {
      const items = obj[sub.fieldName];
      if (!globalThis.Array.isArray(items) || items.length === 0) continue;
      const rows = flattenSubRows(pkVal as string | number, items, sub);
      for (const row of rows) {
        const { sql: iSql, params: iParams } = buildInsert(sub.tableName, row);
        this.db.prepare(iSql).run(...(iParams as SQLQueryBindings[]));
      }
    }
  }

  // ─── Upsert ────────────────────────────────────────────────────────────────

  upsert(opts: UpsertOptions<T, PK>): Infer<T> {
    const parsed = this.parse(opts.data);
    const obj = parsed as Record<string, unknown>;
    const flat = flattenRow(obj, this.meta);

    const conflictCols = (
      globalThis.Array.isArray(opts.conflictTarget)
        ? opts.conflictTarget
        : [opts.conflictTarget]
    ) as string[];

    const allCols = Object.keys(flat);
    const updateCols =
      (opts.update as string[] | undefined) ??
      allCols.filter((c) => !conflictCols.includes(c));

    this.db.transaction(() => {
      const { sql, params } = buildUpsert(
        this.tableName,
        flat,
        conflictCols,
        updateCols
      );
      this.db.prepare(sql).run(...(params as SQLQueryBindings[]));

      const pkVal = obj[this.descriptor.primaryKey as string];

      // Re-sync sub-tables: delete old rows, re-insert
      for (const sub of this.meta.subTables) {
        this.db
          .prepare(`DELETE FROM "${sub.tableName}" WHERE "_owner_id" = ?`)
          .run(pkVal as string | number);

        const items = obj[sub.fieldName];
        if (!globalThis.Array.isArray(items) || items.length === 0) continue;
        const rows = flattenSubRows(pkVal as string | number, items, sub);
        for (const row of rows) {
          const { sql: iSql, params: iParams } = buildInsert(sub.tableName, row);
          this.db.prepare(iSql).run(...(iParams as SQLQueryBindings[]));
        }
      }
    });

    return parsed;
  }

  // ─── Find by PK ────────────────────────────────────────────────────────────

  findById(id: Infer<T>[PK]): Infer<T> | null {
    const pk = this.descriptor.primaryKey as string;
    const stmt = this.db.prepare(
      `SELECT * FROM "${this.tableName}" WHERE "${pk}" = ? LIMIT 1`
    );
    const row = stmt.get(id as string | number | bigint | null) as
      | Record<string, unknown>
      | undefined;
    if (!row) return null;
    return this._hydrateOne(row) as Infer<T>;
  }

  // ─── Find many ─────────────────────────────────────────────────────────────

  findMany(opts: FindOptions<T> = {}): Infer<T>[] {
    const { sql, params } = buildSelect(this.tableName, opts);
    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...(params as SQLQueryBindings[])) as Record<string, unknown>[];
    return rows.map((r) => this._hydrateOne(r, opts.include) as Infer<T>);
  }

  /** findMany with total count — useful for pagination UIs */
  findPage(opts: FindOptions<T> = {}): PageResult<Infer<T>> {
    const { sql, params, countSql, countParams } = buildSelect(
      this.tableName,
      opts
    );

    const rows = (
      this.db.prepare(sql).all(...(params as SQLQueryBindings[])) as Record<string, unknown>[]
    ).map((r) => this._hydrateOne(r, opts.include) as Infer<T>);

    const countRow = this.db.prepare(countSql).get(...(countParams as SQLQueryBindings[])) as {
      _count: number;
    };

    return {
      data: rows,
      total: countRow._count,
      limit: opts.limit ?? rows.length,
      offset: opts.offset ?? 0,
    };
  }

  findOne(opts: FindOptions<T> = {}): Infer<T> | null {
    const rows = this.findMany({ ...opts, limit: 1 });
    return rows[0] ?? null;
  }

  // ─── Count ─────────────────────────────────────────────────────────────────

  count(where?: WhereClause<T>): number {
    const { sql, params } = buildWhere(where);
    const fullSql = `SELECT COUNT(*) as "_count" FROM "${this.tableName}" ${sql}`.trim();
    const row = this.db.prepare(fullSql).get(...(params as SQLQueryBindings[])) as { _count: number };
    return row._count;
  }

  // ─── Update ────────────────────────────────────────────────────────────────

  update(data: UpdateData<T, PK>): Infer<T> | null {
    const obj = data as Record<string, unknown>;
    const pk = this.descriptor.primaryKey as string;
    const pkVal = obj[pk];
    if (pkVal === undefined || pkVal === null) {
      throw new Error(`bunorm: update() requires primary key "${pk}"`);
    }

    // Fetch existing, merge, validate
    const existing = this.findById(pkVal as Infer<T>[PK]);
    if (!existing) return null;

    const merged = this.parse({ ...(existing as object), ...obj });
    const mergedObj = merged as Record<string, unknown>;
    const flat = flattenRow(mergedObj, this.meta);
    const patch = Object.fromEntries(
      Object.entries(flat).filter(([k]) => k !== pk)
    );

    this.db.transaction(() => {
      const { sql, params } = buildUpdate(this.tableName, pk, pkVal, patch);
      this.db.prepare(sql).run(...(params as SQLQueryBindings[]));

      // Re-sync sub-tables
      for (const sub of this.meta.subTables) {
        this.db
          .prepare(`DELETE FROM "${sub.tableName}" WHERE "_owner_id" = ?`)
          .run(pkVal as string | number);

        const items = mergedObj[sub.fieldName];
        if (!globalThis.Array.isArray(items) || items.length === 0) continue;
        const rows = flattenSubRows(pkVal as string | number, items, sub);
        for (const row of rows) {
          const { sql: iSql, params: iParams } = buildInsert(sub.tableName, row);
          this.db.prepare(iSql).run(...(iParams as SQLQueryBindings[]));
        }
      }
    });

    return merged;
  }

  // ─── Delete ────────────────────────────────────────────────────────────────

  deleteById(id: Infer<T>[PK]): boolean {
    const pk = this.descriptor.primaryKey as string;

    return this.db.transaction(() => {
      for (const sub of this.meta.subTables) {
        this.db
          .prepare(`DELETE FROM "${sub.tableName}" WHERE "_owner_id" = ?`)
          .run(id as string | number);
      }
      const result = this.db
        .prepare(`DELETE FROM "${this.tableName}" WHERE "${pk}" = ?`)
        .run(id as string | number);
      return result.changes > 0;
    });
  }

  deleteWhere(where: WhereClause<T>): number {
    const { sql, params } = buildDelete(this.tableName, where);
    const result = this.db.prepare(sql).run(...(params as SQLQueryBindings[]));
    return result.changes;
  }

  // ─── Sub-table hydration ───────────────────────────────────────────────────

  private _hydrateOne(
    flat: Record<string, unknown>,
    include?: string[]
  ): Record<string, unknown> {
    const subRows = new Map<string, Record<string, unknown>[]>();

    const pk = this.descriptor.primaryKey as string;
    const pkVal = flat[pk];

    for (const sub of this.meta.subTables) {
      // Only hydrate if caller asked for it OR there are sub-tables defined
      if (include && !include.includes(sub.fieldName)) {
        subRows.set(sub.tableName, []);
        continue;
      }
      const rows = this.db
        .prepare(
          `SELECT * FROM "${sub.tableName}" WHERE "_owner_id" = ? ORDER BY "_index" ASC`
        )
        .all(pkVal as string | number) as Record<string, unknown>[];

      // Strip internal columns
      const cleaned = rows.map((r) => {
        const { _id, _owner_id, _index, ...rest } = r as Record<string, unknown> & {
          _id: unknown;
          _owner_id: unknown;
          _index: unknown;
        };
        void _id; void _owner_id; void _index;
        return rest;
      });

      subRows.set(sub.tableName, cleaned);
    }

    return hydrateRow(flat, this.meta, subRows);
  }

  // ─── Raw access ────────────────────────────────────────────────────────────

  /** Escape hatch — run arbitrary SQL against the underlying DB */
  raw<R = unknown>(sql: string, ...params: unknown[]): R[] {
    return this.db.prepare(sql).all(...(params as SQLQueryBindings[])) as R[];
  }
}
