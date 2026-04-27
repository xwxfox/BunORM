/**
 * foxdb/src/repository.ts
 * Typed repository for a single table - insert, find, update, delete,
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

/**
 * Typed repository for a single table. Every entry in your `tables` config
 * becomes one of these on the ORM object, fully typed to its schema.
 *
 * @category Repositories
 *
 * @example
 * ```ts
 * const orm = createORM({
 *   tables: {
 *     users: table(UserSchema, (s) => ({ primaryKey: s.id })),
 *   },
 * });
 *
 * // All methods are fully typed - wrong property names are caught at compile time
 * orm.users.insert({ id: "u1", name: "alice", email: "a@x.com" });
 * const user = orm.users.findById("u1");
 * orm.users.update({ id: "u1", name: "alice smith" });
 * orm.users.deleteById("u1");
 * ```
 */
export class Repository<
  T extends TObject,
  PK extends ScalarKeys<T>,
  Mat = never,
  TS = {}
> {
  readonly tableName: string;
  /** table metadata - columns, sub-tables, indexes */
  readonly meta: TableMeta;

  private readonly validator: ReturnType<typeof Compile<T>>;
  private readonly db: BunDatabase;
  private readonly descriptor: TableConfig<T, PK>;
  private _entityProto: object | null = null;
  private readonly _timestampNames: { createdAt: string | null; updatedAt: string | null };
  private _materialize?: (
    record: Record<string, unknown>
  ) => Record<string, unknown>;
  private _materializeMany?: (
    records: Record<string, unknown>[]
  ) => Record<string, unknown>[];
  private _events?: EventBus;

  /** @internal */
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
    this.validator = Compile(config.schema);
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
  private _wrap(data: Record<string, unknown>): Entity<Infer<T>, Mat, TS> {
    if (!this._entityProto) return data as Entity<Infer<T>, Mat, TS>;
    const entity = Object.create(this._entityProto);
    Object.assign(entity, data);
    return entity as Entity<Infer<T>, Mat, TS>;
  }

  /** Narrow a parsed schema value to a plain record for dynamic property access */
  private _record(value: Infer<T>): Record<string, unknown> {
    return value as Record<string, unknown>;
  }

  private _emit(
    operation: TableOperation,
    payload: Omit<TableEventPayload<Infer<T>, TableOperation>, "table" | "operation" | "timestamp">
  ): void {
    if (!this._events) return;
    const ts = Date.now();
    const base = { table: this.tableName, operation, timestamp: ts };
    const full: TableEventPayload<Infer<T>, TableOperation> = { ...base, ...payload };

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

  /**
   * Validate and coerce data against the schema. Throws on invalid input.
   *
   * @group Validation
   *
   * @example
   * ```ts
   * const user = orm.users.parse({ id: "u1", name: "alice" });
   * // user is typed as Infer<typeof UserSchema>
   * ```
   */
  parse(data: unknown): Infer<T> {
    return this.validator.Parse(data);
  }

  /**
   * Type-guard - returns true if data matches the schema.
   *
   * @group Validation
   *
   * @example
   * ```ts
   * if (orm.users.check(someData)) {
   *   // someData is now typed as Infer<typeof UserSchema>
   * }
   * ```
   */
  check(data: unknown): data is Infer<T> {
    return this.validator.Check(data);
  }

  // ─── Insert ────────────────────────────────────────────────────────────────

  /**
   * Insert a single record. Returns the inserted entity.
   *
   * @group Writing
   *
   * @example
   * ```ts
   * const user = orm.users.insert({
   *   id: "u1",
   *   name: "alice",
   *   email: "alice@example.com",
   * });
   * ```
   */
  insert(data: InsertData<T>): Entity<Infer<T>, Mat, TS> {
    return withTrace("repository.insert", { table: this.tableName }, () => {
      const parsed = this.parse(data);
      const obj = this._record(parsed);
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
          const rows = flattenSubRows(pkVal as string | number, items as Record<string, unknown>[], sub);
          for (const row of rows) {
            const { sql: iSql, params: iParams } = buildInsert(sub.tableName, row);
            this.db.prepare(iSql).run(...(iParams as SQLQueryBindings[]));
          }
        }
      });

      this._emit("insert", { data: parsed });
      return this._wrap(this._record(parsed));
    });
  }

  /**
   * Insert many records in a single transaction.
   *
   * @group Writing
   *
   * @example
   * ```ts
   * orm.users.insertMany([
   *   { id: "u1", name: "alice", email: "a@x.com" },
   *   { id: "u2", name: "bob", email: "b@x.com" },
   * ]);
   * ```
   */
  insertMany(records: InsertData<T>[]): Entity<Infer<T>, Mat, TS>[] {
    return withTrace("repository.insertMany", { table: this.tableName }, () => {
      const parsed = records.map((r) => this.parse(r));
      this.db.transaction(() => {
        for (const p of parsed) this._insertParsed(this._record(p));
      });
      this._emit("insertMany", { data: parsed });
      return parsed.map((p) => this._wrap(this._record(p)));
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
      const rows = flattenSubRows(pkVal as string | number, items as Record<string, unknown>[], sub);
      for (const row of rows) {
        const { sql: iSql, params: iParams } = buildInsert(sub.tableName, row);
        this.db.prepare(iSql).run(...(iParams as SQLQueryBindings[]));
      }
    }
  }

  // ─── Upsert ────────────────────────────────────────────────────────────────

  /**
   * Insert or update on conflict. If the record exists (by conflict target),
   * it updates the specified columns instead.
   *
   * @group Writing
   *
   * @example
   * ```ts
   * orm.users.upsert({
   *   data: { id: "u1", name: "alice", email: "new@x.com" },
   *   conflictTarget: "id",
   * });
   * ```
   */
  upsert(opts: UpsertOptions<T, PK>): Entity<Infer<T>, Mat, TS> {
    return withTrace("repository.upsert", { table: this.tableName }, () => {
      const parsed = this.parse(opts.data);
      const obj = this._record(parsed);
      const now = Date.now();
      if (this._timestampNames.createdAt) obj[this._timestampNames.createdAt] = now;
      if (this._timestampNames.updatedAt) obj[this._timestampNames.updatedAt] = now;
      const flat = flattenRow(obj, this.meta);

      const conflictCols: string[] = (
        globalThis.Array.isArray(opts.conflictTarget)
          ? opts.conflictTarget
          : [opts.conflictTarget]
      );

      const allCols = Object.keys(flat);
      const updateCols: string[] =
        opts.update ??
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
          const rows = flattenSubRows(pkVal as string | number, items as Record<string, unknown>[], sub);
          for (const row of rows) {
            const { sql: iSql, params: iParams } = buildInsert(sub.tableName, row);
            this.db.prepare(iSql).run(...(iParams as SQLQueryBindings[]));
          }
        }
      });

      this._emit("upsert", { data: parsed });
      return this._wrap(this._record(parsed));
    });
  }

  // ─── Find by PK ────────────────────────────────────────────────────────────

  /**
   * Find a record by its primary key.
   *
   * @group Reading
   *
   * @example
   * ```ts
   * const user = orm.users.findById("u1");
   * if (user) console.log(user.name);
   * ```
   */
  findById(id: Infer<T>[PK]): Entity<Infer<T>, Mat, TS> | null {
    return withTrace("repository.findById", { table: this.tableName }, () => {
      const result = this._findByIdRaw(id);
      this._emit("findById", { id, result });
      return result;
    });
  }

  /** Internal findById without event emission - used by update() */
  private _findByIdRaw(id: Infer<T>[PK]): Entity<Infer<T>, Mat, TS> | null {
    const pk = this.descriptor.primaryKey.name;
    const stmt = this.db.prepare(
      `SELECT * FROM "${this.tableName}" WHERE "${pk}" = ? LIMIT 1`
    );
    const row = stmt.get(id as string | number | bigint | null) as
      | Record<string, unknown>
      | undefined;
    if (!row) return null;
    return this._wrap(this._hydrateOne(row));
  }

  // ─── Find many ─────────────────────────────────────────────────────────────

  /**
   * Find many records matching the given filters.
   *
   * @group Reading
   *
   * @example
   * ```ts
   * const adults = orm.users.findMany({
   *   where: { age: { gte: 18 } },
   *   orderBy: { column: "name", direction: "ASC" },
   *   limit: 10,
   * });
   *
   * // Include sub-tables
   * const orders = orm.orders.findMany({ include: ["lineItems"] });
   * ```
   */
  findMany(opts: FindOptions<T> = {}): Entity<Infer<T>, Mat, TS>[] {
    return withTrace("repository.findMany", { table: this.tableName }, () => {
      const { sql, params } = buildSelect(this.tableName, opts);
      const stmt = this.db.prepare(sql);
      const rows = stmt.all(...(params as SQLQueryBindings[])) as Record<string, unknown>[];
      const results = rows.map((r) => this._wrap(this._hydrateOne(r, opts.include)));
      this._emit("findMany", { options: opts, result: results });
      return results;
    });
  }

  /**
   * Find many with total count - useful for pagination.
   *
   * @group Reading
   *
   * @example
   * ```ts
   * const page = orm.users.findPage({
   *   where: { status: { eq: "active" } },
   *   limit: 10,
   *   offset: 0,
   * });
   * // page.data - the records
   * // page.total - total matching records
   * // page.limit, page.offset - what you passed in
   * ```
   */
  findPage(opts: FindOptions<T> = {}): PageResult<Entity<Infer<T>, Mat, TS>> {
    return withTrace("repository.findPage", { table: this.tableName }, () => {
      const { sql, params, countSql, countParams } = buildSelect(
        this.tableName,
        opts
      );

      const rows = (
        this.db.prepare(sql).all(...(params as SQLQueryBindings[])) as Record<string, unknown>[]
      ).map((r) => this._wrap(this._hydrateOne(r, opts.include)));

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

  /**
   * Find a single record matching the given filters. Equivalent to `findMany`
   * with `limit: 1`, but returns the entity directly (or `null`).
   *
   * @group Reading
   *
   * @example
   * ```ts
   * const admin = orm.users.findOne({
   *   where: { role: { eq: "admin" } },
   * });
   * ```
   */
  findOne(opts: FindOptions<T> = {}): Entity<Infer<T>, Mat, TS> | null {
    return withTrace("repository.findOne", { table: this.tableName }, () => {
      const { sql, params } = buildSelect(this.tableName, { ...opts, limit: 1 });
      const stmt = this.db.prepare(sql);
      const row = stmt.get(...(params as SQLQueryBindings[])) as Record<string, unknown> | undefined;
      const result = row ? this._wrap(this._hydrateOne(row, opts.include)) : null;
      this._emit("findOne", { options: opts, result });
      return result;
    });
  }

  /**
   * Find many with resolved relations (n+1 safe). If you have cross-table
   * relations configured, this eagerly loads them in a single batch query.
   *
   * @group Reading
   *
   * @example
   * ```ts
   * const orders = orm.orders.findManyMaterialized();
   * for (const item of orders[0].lineItems) {
   *   console.log(item.product.name); // eagerly resolved
   * }
   * ```
   */
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

  /**
   * Count records matching the given filters.
   *
   * @group Reading
   *
   * @example
   * ```ts
   * const total = orm.users.count();
   * const adults = orm.users.count({ age: { gte: 18 } });
   * ```
   */
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

  /**
   * Update a record - must include the primary key. Returns the updated
   * entity, or `null` if no record matched.
   *
   * @group Writing
   *
   * @example
   * ```ts
   * orm.users.update({ id: "u1", name: "alice smith" });
   * ```
   */
  update(data: UpdateData<T, PK>): Entity<Infer<T>, Mat, TS> | null {
    return withTrace("repository.update", { table: this.tableName }, () => {
      const obj = this._record(data as Infer<T>);
      const pk = this.descriptor.primaryKey.name;
      const pkVal = obj[pk];
      if (pkVal === undefined || pkVal === null) {
        raise("UPDATE_MISSING_PK", `foxdb: update() requires primary key "${pk}"`, {
          table: this.tableName,
          column: pk,
        });
      }

      // Fetch existing, merge, validate - use raw find to avoid spurious read events
      const existing = this._findByIdRaw(pkVal as Infer<T>[PK]);
      if (!existing) return null;

      const merged = this.parse({ ...existing, ...data });
      const mergedObj = this._record(merged);
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
          const rows = flattenSubRows(pkVal as string | number, items as Record<string, unknown>[], sub);
          for (const row of rows) {
            const { sql: iSql, params: iParams } = buildInsert(sub.tableName, row);
            this.db.prepare(iSql).run(...(iParams as SQLQueryBindings[]));
          }
        }
      });

      const result = this._wrap(this._record(merged));
      this._emit("update", { id: pkVal, data: { ...data } });
      return result;
    });
  }

  // ─── Delete ────────────────────────────────────────────────────────────────

  /**
   * Delete a record by its primary key. Returns `true` if a record was deleted.
   *
   * @group Writing
   *
   * @example
   * ```ts
   * const deleted = orm.users.deleteById("u1");
   * ```
   */
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

  /**
   * Delete records matching the given filters. Returns the number of rows deleted.
   *
   * @group Writing
   *
   * @example
   * ```ts
   * const removed = orm.users.deleteWhere({ status: { eq: "banned" } });
   * ```
   */
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

  /**
   * Truncate the table and all sub-tables. Deletes all rows but keeps the schema.
   *
   * @group Lifecycle
   *
   * @example
   * ```ts
   * orm.users.flush(); // users table is now empty
   * ```
   */
  flush(): void {
    withTrace("repository.flush", { table: this.tableName }, () => {
      this.db.exec(`DELETE FROM "${this.tableName}"`);
      for (const sub of this.meta.subTables) {
        this.db.exec(`DELETE FROM "${sub.tableName}"`);
      }
      this._emit("flush", {});
    });
  }

  /**
   * Drop the table and all sub-tables. **This destroys the schema and all data.**
   *
   * @group Lifecycle
   *
   * @example
   * ```ts
   * orm.users.drop(); // table no longer exists
   * ```
   */
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

  /**
   * Run raw SQL - escape hatch for queries the ORM doesn't support directly.
   *
   * @group Raw SQL
   *
   * @example
   * ```ts
   * const rows = orm.users.raw<{ name: string; count: number }>(
   *   'SELECT name, COUNT(*) as count FROM users GROUP BY name'
   * );
   * ```
   */
  raw<R = unknown>(sql: string, ...params: unknown[]): R[] {
    return this.db.prepare(sql).all(...(params as SQLQueryBindings[])) as R[];
  }
}
