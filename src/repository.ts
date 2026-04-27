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
  Entity,
  TableOperation,
  BroadOperation,
  TableEventPayload,
} from "./types.ts";
import type { BunDatabase, SQLQueryBindings } from "./database.ts";
import type { EventBus } from "./events.ts";
import { withTrace, raise } from "./errors.ts";
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
import { resolveTimestampNames } from "./timestamps.ts";
import type { TimestampConfig } from "./timestamps.ts";

// ─── Repository ───────────────────────────────────────────────────────────────

export class Repository<
  T extends TObject,
  PK extends ScalarKeys<T>,
  Mat = never,
  TS = {}
> {
  readonly tableName: string;
  readonly meta: TableMeta;

  /** Compiled validator — JIT-accelerated schema check + Parse */
  private readonly validator: ReturnType<typeof Compile<T>>;

  private readonly db: BunDatabase;
  private readonly descriptor: TableConfig<T, PK>;

  /** Shared prototype for entity objects */
  private _entityProto: object | null = null;

  /** Resolved timestamp column names */
  private readonly _timestampNames: { createdAt: string | null; updatedAt: string | null };

  /** Materializer closures injected after two-pass init */
  private _materialize?: (
    record: Record<string, unknown>
  ) => Record<string, unknown>;
  private _materializeMany?: (
    records: Record<string, unknown>[]
  ) => Record<string, unknown>[];

  private _events?: EventBus;

  setEventBus(bus: EventBus): void {
    this._events = bus;
  }

  constructor(
    tableName: string,
    config: TableConfig<T, PK>,
    db: BunDatabase
  ) {
    this.tableName = tableName;
    this.descriptor = config;
    this.db = db;
    this.meta = introspectTable(tableName, config.schema);
    this._timestampNames = resolveTimestampNames(config.timestamps, this.meta);

    // Compile schema once — reused for every validate/parse call
    this.validator = Compile(config.schema);

    // Create tables + indexes
    this._migrate();
  }

  /** Inject materializers after ORM two-pass init */
  setMaterializer(
    single: (record: Record<string, unknown>) => Record<string, unknown>,
    many: (records: Record<string, unknown>[]) => Record<string, unknown>[]
  ): void {
    this._materialize = single;
    this._materializeMany = many;

    // Build shared entity prototype
    const proto = Object.create(null);
    Object.defineProperty(proto, "materialize", {
      value: function () {
        return single(this);
      },
      writable: false,
      enumerable: false,
      configurable: false,
    });
    this._entityProto = proto;
  }

  /** Wrap raw data in an entity object */
  private _wrap(data: Record<string, unknown>): Record<string, unknown> {
    if (!this._entityProto) return data;
    const entity = Object.create(this._entityProto);
    Object.assign(entity, data);
    return entity;
  }

  private _emit<Op extends TableOperation>(
    operation: Op,
    payload: Omit<TableEventPayload<Infer<T>, Op>, "table" | "operation" | "timestamp">
  ): void {
    if (!this._events) return;
    const ts = Date.now();
    const base = { table: this.tableName, operation, timestamp: ts };
    const full = { ...base, ...payload } as TableEventPayload<Infer<T>, Op>;

    const opKey = `${this.tableName}.${operation}`;
    if (this._events.has(opKey)) {
      this._events.emit(opKey, full);
    }

    // Broad category mapping
    let broad: BroadOperation | undefined;
    if (operation.startsWith("find") || operation === "count") broad = "read";
    else if (operation === "delete" || operation === "deleteWhere" || operation === "flush") broad = "delete";
    else broad = "write";

    const broadKey = `${this.tableName}.${broad}`;
    if (this._events.has(broadKey)) {
      this._events.emit(broadKey, { ...full, operation: broad });
    }
  }

  // ─── Migration ─────────────────────────────────────────────────────────────

  private _migrate(): void {
    const pk = this.descriptor.primaryKey.name;
    const stmts = buildCreateTableSQL(this.meta, pk);
    this.db.transaction(() => {
      for (const sql of stmts) this.db.exec(sql);

      for (const idx of this.descriptor.indexes ?? []) {
        this.db.exec(
          buildIndexSQL(
            this.tableName,
            idx.columns.map((c) => c.name),
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

  insert(data: InsertData<T>): Entity<Infer<T>, Mat, TS> {
    return withTrace("repository.insert", { table: this.tableName }, () => {
      const parsed = this.parse(data);
      const obj = parsed as Record<string, unknown>;
      const now = Date.now();
      if (this._timestampNames.createdAt) obj[this._timestampNames.createdAt] = now;
      if (this._timestampNames.updatedAt) obj[this._timestampNames.updatedAt] = now;

      this.db.transaction(() => {
        // Main row
        const flat = flattenRow(obj, this.meta);
        const { sql, params } = buildInsert(this.tableName, flat);
        this.db.prepare(sql).run(...(params as SQLQueryBindings[]));

        const pkVal = obj[this.descriptor.primaryKey.name];

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

      this._emit("insert", { data: parsed });
      return this._wrap(parsed as Record<string, unknown>) as Entity<Infer<T>, Mat, TS>;
    });
  }

  /** Insert many records in a single transaction */
  insertMany(records: InsertData<T>[]): Entity<Infer<T>, Mat, TS>[] {
    return withTrace("repository.insertMany", { table: this.tableName }, () => {
      const parsed = records.map((r) => this.parse(r));
      this.db.transaction(() => {
        for (const p of parsed) this._insertParsed(p as Record<string, unknown>);
      });
      this._emit("insertMany", { data: parsed });
      return parsed.map((p) => this._wrap(p as Record<string, unknown>) as Entity<Infer<T>, Mat, TS>);
    });
  }

  private _insertParsed(obj: Record<string, unknown>): void {
    const now = Date.now();
    if (this._timestampNames.createdAt) obj[this._timestampNames.createdAt] = now;
    if (this._timestampNames.updatedAt) obj[this._timestampNames.updatedAt] = now;
    const flat = flattenRow(obj, this.meta);
    const { sql, params } = buildInsert(this.tableName, flat);
    this.db.prepare(sql).run(...(params as SQLQueryBindings[]));
    const pkVal = obj[this.descriptor.primaryKey.name];
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

  upsert(opts: UpsertOptions<T, PK>): Entity<Infer<T>, Mat, TS> {
    return withTrace("repository.upsert", { table: this.tableName }, () => {
      const parsed = this.parse(opts.data);
      const obj = parsed as Record<string, unknown>;
      const now = Date.now();
      if (this._timestampNames.createdAt) obj[this._timestampNames.createdAt] = now;
      if (this._timestampNames.updatedAt) obj[this._timestampNames.updatedAt] = now;
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

        const pkVal = obj[this.descriptor.primaryKey.name];

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

      this._emit("upsert", { data: parsed });
      return this._wrap(parsed as Record<string, unknown>) as Entity<Infer<T>, Mat, TS>;
    });
  }

  // ─── Find by PK ────────────────────────────────────────────────────────────

  findById(id: Infer<T>[PK]): Entity<Infer<T>, Mat, TS> | null {
    return withTrace("repository.findById", { table: this.tableName }, () => {
      const result = this._findByIdRaw(id);
      this._emit("findById", { id, result });
      return result;
    });
  }

  /** Internal findById without event emission — used by update() */
  private _findByIdRaw(id: Infer<T>[PK]): Entity<Infer<T>, Mat, TS> | null {
    const pk = this.descriptor.primaryKey.name;
    const stmt = this.db.prepare(
      `SELECT * FROM "${this.tableName}" WHERE "${pk}" = ? LIMIT 1`
    );
    const row = stmt.get(id as string | number | bigint | null) as
      | Record<string, unknown>
      | undefined;
    if (!row) return null;
    return this._wrap(this._hydrateOne(row)) as Entity<Infer<T>, Mat, TS>;
  }

  // ─── Find many ─────────────────────────────────────────────────────────────

  findMany(opts: FindOptions<T> = {}): Entity<Infer<T>, Mat, TS>[] {
    return withTrace("repository.findMany", { table: this.tableName }, () => {
      const { sql, params } = buildSelect(this.tableName, opts);
      const stmt = this.db.prepare(sql);
      const rows = stmt.all(...(params as SQLQueryBindings[])) as Record<string, unknown>[];
      const results = rows.map((r) => this._wrap(this._hydrateOne(r, opts.include)) as Entity<Infer<T>, Mat, TS>);
      this._emit("findMany", { options: opts, result: results });
      return results;
    });
  }

  /** findMany with total count — useful for pagination UIs */
  findPage(opts: FindOptions<T> = {}): PageResult<Entity<Infer<T>, Mat, TS>> {
    return withTrace("repository.findPage", { table: this.tableName }, () => {
      const { sql, params, countSql, countParams } = buildSelect(
        this.tableName,
        opts
      );

      const rows = (
        this.db.prepare(sql).all(...(params as SQLQueryBindings[])) as Record<string, unknown>[]
      ).map((r) => this._wrap(this._hydrateOne(r, opts.include)) as Entity<Infer<T>, Mat, TS>);

      const countRow = this.db.prepare(countSql).get(...(countParams as SQLQueryBindings[])) as {
        _count: number;
      };

      const result = {
        data: rows,
        total: countRow._count,
        limit: opts.limit ?? rows.length,
        offset: opts.offset ?? 0,
      };

      this._emit("findPage", { options: opts, result });
      return result;
    });
  }

  findOne(opts: FindOptions<T> = {}): Entity<Infer<T>, Mat, TS> | null {
    return withTrace("repository.findOne", { table: this.tableName }, () => {
      const { sql, params } = buildSelect(this.tableName, { ...opts, limit: 1 });
      const stmt = this.db.prepare(sql);
      const row = stmt.get(...(params as SQLQueryBindings[])) as Record<string, unknown> | undefined;
      const result = row ? this._wrap(this._hydrateOne(row, opts.include)) as Entity<Infer<T>, Mat, TS> : null;
      this._emit("findOne", { options: opts, result });
      return result;
    });
  }

  /** Batch materialized find — N+1 safe */
  findManyMaterialized(opts: FindOptions<T> = {}): Entity<Infer<T>, Mat, TS>[] {
    const rows = this.findMany(opts);
    if (!this._materializeMany) return rows;
    const materialized = this._materializeMany(
      rows as Record<string, unknown>[]
    );
    // Re-attach entity prototype in case materializeMany created copies
    if (this._entityProto) {
      for (const row of materialized) {
        if (Object.getPrototypeOf(row) !== this._entityProto) {
          Object.setPrototypeOf(row, this._entityProto);
        }
      }
    }
    return materialized as Entity<Infer<T>, Mat, TS>[];
  }

  // ─── Count ─────────────────────────────────────────────────────────────────

  count(where?: WhereClause<T>): number {
    return withTrace("repository.count", { table: this.tableName }, () => {
      const { sql, params } = buildWhere(where);
      const fullSql = `SELECT COUNT(*) as "_count" FROM "${this.tableName}" ${sql}`.trim();
      const row = this.db.prepare(fullSql).get(...(params as SQLQueryBindings[])) as { _count: number };
      this._emit("count", { where, result: row._count });
      return row._count;
    });
  }

  // ─── Update ────────────────────────────────────────────────────────────────

  update(data: UpdateData<T, PK>): Entity<Infer<T>, Mat, TS> | null {
    return withTrace("repository.update", { table: this.tableName }, () => {
      const obj = data as Record<string, unknown>;
      const pk = this.descriptor.primaryKey.name;
      const pkVal = obj[pk];
      if (pkVal === undefined || pkVal === null) {
        raise("UPDATE_MISSING_PK", `bunorm: update() requires primary key "${pk}"`, {
          table: this.tableName,
          column: pk,
        });
      }

      // Fetch existing, merge, validate — use raw find to avoid spurious read events
      const existing = this._findByIdRaw(pkVal as Infer<T>[PK]);
      if (!existing) return null;

      const merged = this.parse({ ...(existing as object), ...obj });
      const mergedObj = merged as Record<string, unknown>;
      if (this._timestampNames.updatedAt) {
        mergedObj[this._timestampNames.updatedAt] = Date.now();
      }
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

      const result = this._wrap(merged as Record<string, unknown>) as Entity<Infer<T>, Mat, TS>;
      this._emit("update", { id: pkVal, data: obj as unknown as Partial<Infer<T>> });
      return result;
    });
  }

  // ─── Delete ────────────────────────────────────────────────────────────────

  deleteById(id: Infer<T>[PK]): boolean {
    return withTrace("repository.deleteById", { table: this.tableName }, () => {
      const pk = this.descriptor.primaryKey.name;

      const result = this.db.transaction(() => {
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
      this._emit("delete", { id });
      return result;
    });
  }

  deleteWhere(where: WhereClause<T>): number {
    return withTrace("repository.deleteWhere", { table: this.tableName }, () => {
      const { sql: whereSql, params } = buildWhere(where);
      const pk = this.descriptor.primaryKey.name;

      const changes = this.db.transaction(() => {
        // Cascade to sub-tables first
        for (const sub of this.meta.subTables) {
          const delSubSql = `DELETE FROM "${sub.tableName}" WHERE "_owner_id" IN (SELECT "${pk}" FROM "${this.tableName}" ${whereSql})`.trim();
          this.db.prepare(delSubSql).run(...(params as SQLQueryBindings[]));
        }

        const delSql = `DELETE FROM "${this.tableName}" ${whereSql}`.trim();
        const result = this.db.prepare(delSql).run(...(params as SQLQueryBindings[]));
        return result.changes;
      });

      this._emit("deleteWhere", { where, result: changes });
      return changes;
    });
  }

  // ─── Table lifecycle ───────────────────────────────────────────────────────

  flush(): void {
    withTrace("repository.flush", { table: this.tableName }, () => {
      this.db.exec(`DELETE FROM "${this.tableName}"`);
      for (const sub of this.meta.subTables) {
        this.db.exec(`DELETE FROM "${sub.tableName}"`);
      }
      this._emit("flush", {});
    });
  }

  drop(): void {
    for (const sub of this.meta.subTables) {
      this.db.exec(`DROP TABLE IF EXISTS "${sub.tableName}"`);
    }
    this.db.exec(`DROP TABLE IF EXISTS "${this.tableName}"`);
  }

  // ─── Sub-table hydration ───────────────────────────────────────────────────

  private _hydrateOne(
    flat: Record<string, unknown>,
    include?: string[]
  ): Record<string, unknown> {
    const subRows = new Map<string, Record<string, unknown>[]>();

    const pk = this.descriptor.primaryKey.name;
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
