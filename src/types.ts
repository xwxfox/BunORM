/**
 * bunorm/src/types.ts
 * Core type utilities - all ORM-level TypeScript types live here.
 * Zero runtime cost; pure compile-time machinery.
 */

import type {
  TObject,
  TArray,
  TSchema,
  TProperties,
  Static,
} from "typebox";
import type { ColumnRef, TScalarSchema } from "./columns.ts";
import type { TypedRelation } from "./typed-relation.ts";

// ─── Primitive column types ──────────────────────────────────────────────────

/** scalar values sqlite can store natively */
export type SqliteScalar = string | number | boolean | null | bigint;

// ─── Schema introspection helpers ────────────────────────────────────────────

/** @internal */
export type ScalarProperties<P extends TProperties> = {
  [K in keyof P as P[K] extends TArray<infer _> ? never : K]: P[K];
};

/** @internal */
export type ArrayOfObjectProperties<P extends TProperties> = {
  [K in keyof P as P[K] extends TArray<TObject>
  ? K
  : never]: P[K] extends TArray<infer Item> ? Item : never;
};

/** column names that are scalar (not arrays or nested objects) */
export type ScalarKeys<T extends TObject> =
  keyof ScalarProperties<T["properties"]> & string;

/** @internal */
export type SubTableKeys<T extends TObject> =
  keyof ArrayOfObjectProperties<T["properties"]> & string;

/** @internal */
export type SubTableScalarPath<T extends TObject> = {
  [K in SubTableKeys<T>]: T["properties"][K] extends TArray<infer Item>
  ? Item extends TObject
  ? `${K}.${ScalarKeys<Item>}`
  : never
  : never;
}[SubTableKeys<T>];

/** @internal */
export type ScalarPath<T extends TObject> =
  | ScalarKeys<T>
  | SubTableScalarPath<T>;

// ─── Static inference shortcuts ──────────────────────────────────────────────

/** the typescript type that matches a typebox schema */
export type Infer<T extends TSchema> = Static<T>;

/** @internal */
export type FlatRow<T extends TObject> = {
  [K in ScalarKeys<T>]: Static<T["properties"][K]>;
};

/** @internal */
export type SubTableItem<
  T extends TObject,
  K extends SubTableKeys<T>
> = T["properties"][K] extends TArray<infer Item extends TSchema>
  ? Static<Item>
  : never;

/** @internal */
export type SubTableItemKeys<
  T extends TObject,
  K extends SubTableKeys<T>
> = T["properties"][K] extends TArray<infer Item>
  ? Item extends TObject
  ? ScalarKeys<Item>
  : never
  : never;

// ─── Filter / Where types ─────────────────────────────────────────────────────

export type ScalarFilter<V> = V extends string
  ?
  | { eq: V }
  | { ne: V }
  | { like: string }
  | { in: V[] }
  | { notIn: V[] }
  | { isNull: true }
  | { isNotNull: true }
  : V extends number | bigint
  ?
  | { eq: V }
  | { ne: V }
  | { gt: V }
  | { gte: V }
  | { lt: V }
  | { lte: V }
  | { between: [V, V] }
  | { in: V[] }
  | { isNull: true }
  | { isNotNull: true }
  : V extends boolean
  ? { eq: V } | { isNull: true } | { isNotNull: true }
  : { isNull: true } | { isNotNull: true };

/**
 * Where filters for queries - only scalar columns are filterable.
 *
 * @example
 * ```ts
 * // String filters
 * orm.users.findMany({ where: { name: { like: "%alice%" } } });
 * orm.users.findMany({ where: { email: { in: ["a@x.com", "b@x.com"] } } });
 *
 * // Number filters
 * orm.users.findMany({ where: { age: { gte: 18, lte: 65 } } });
 * orm.products.findMany({ where: { price: { between: [10, 100] } } });
 *
 * // Boolean / null filters
 * orm.users.findMany({ where: { active: { eq: true } } });
 * orm.users.findMany({ where: { deletedAt: { isNull: true } } });
 * ```
 * @category Query Types
 */
export type WhereClause<T extends TObject> = {
  [K in ScalarKeys<T>]?: ScalarFilter<Static<T["properties"][K]>>;
};

// ─── OrderBy ─────────────────────────────────────────────────────────────────

/** sort direction for queries */
export type OrderByClause<T extends TObject> = {
  column: ScalarKeys<T>;
  direction?: "ASC" | "DESC";
};

// ─── Pagination ───────────────────────────────────────────────────────────────

/** @internal */
export interface PaginationOptions {
  limit?: number;
  offset?: number;
}

// ─── Query options ────────────────────────────────────────────────────────────

/**
 * Options for `findMany`, `findPage`, and `findOne`.
 *
 * @example
 * ```ts
 * orm.users.findMany({
 *   where: { age: { gte: 18 } },
 *   orderBy: { column: "name", direction: "ASC" },
 *   limit: 10,
 *   offset: 0,
 * });
 *
 * // Multiple orderBy clauses
 * orm.users.findMany({
 *   orderBy: [
 *     { column: "status", direction: "DESC" },
 *     { column: "createdAt", direction: "ASC" },
 *   ],
 * });
 *
 * // Include sub-tables
 * orm.orders.findMany({ include: ["lineItems"] });
 * ```
 * @category Query Types
 */
export interface FindOptions<T extends TObject> extends PaginationOptions {
  where?: WhereClause<T>;
  orderBy?: OrderByClause<T> | OrderByClause<T>[];
  include?: SubTableKeys<T>[];
}

// ─── Insert / Update ──────────────────────────────────────────────────────────

/** full record to insert */
export type InsertData<T extends TObject> = Infer<T>;

/** update payload - must include the primary key */
export type UpdateData<T extends TObject, PK extends ScalarKeys<T>> = Pick<
  Infer<T>,
  PK
> &
  Partial<Omit<Infer<T>, PK>>;

// ─── Index definition ────────────────────────────────────────────────────────

/** index on one or more columns */
export interface IndexDefinition {
  name?: string;
  columns: ColumnRef<string, TScalarSchema>[];
  unique?: boolean;
}

// ─── Timestamp types ─────────────────────────────────────────────────────────

/** timestamp configuration for a table */
export type TimestampConfig = true | false | { createdAt?: string; updatedAt?: string } | undefined;

/** @internal */
export type TimestampShape<T extends TimestampConfig> = true extends T
  ? { createdAt: number; updatedAt: number }
  : [T] extends [{ createdAt?: infer C; updatedAt?: infer U }]
  ? (C extends string ? { [K in C]: number } : {}) & (U extends string ? { [K in U]: number } : {})
  : {};

// ─── Entity helper ───────────────────────────────────────────────────────────

/**
 * A database row with optional timestamps and materialized relations.
 *
 * @example
 * ```ts
 * // Without relations
 * type User = Entity<{ id: string; name: string }>;
 * // → { id: string; name: string }
 *
 * // With timestamps
 * type UserWithTS = Entity<{ id: string }, never, { createdAt: number }>;
 * // → { id: string; createdAt: number }
 *
 * // With relations
 * type UserWithRels = Entity<{ id: string }, { posts: Post[] }>;
 * // → { id: string; materialize(): { posts: Post[] } }
 * ```
 * @category Query Types
 */
export type Entity<T, Mat = never, TS = {}> = [Mat] extends [never]
  ? T & TS
  : T & TS & { materialize(): Mat };

// ─── Table config (what users pass per table in `createORM`) ─────────────────

/** table descriptor passed to createORM */
export interface TableConfig<
  T extends TObject = TObject,
  PK extends string = string,
  TS extends TimestampConfig = undefined
> {
  schema: T;
  primaryKey: ColumnRef<PK>;
  indexes?: IndexDefinition[];
  subTables?: Partial<Record<string, { indexes?: IndexDefinition[] }>>;
  timestamps?: TS;
}

// ─── Meta accessors ──────────────────────────────────────────────────────────

/** read-only metadata about the current database schema */
export interface MetaAccessors {
  schemaHash: string | null;
  schemaJSON: string | null;
  tables: string[] | null;
  relations: unknown[] | null;
  version: string | null;
}

// ─── Relations ────────────────────────────────────────────────────────────────

/** @internal */
export interface BuiltRelation {
  ownerTable: string;
  ownerField: string;
  targetTable: string;
  targetField: string;
  as?: string;
  kind: "scalar" | "subTable";
}

/** @internal */
export interface RelationEntry<
  Tables extends Record<string, TableConfig<any, any, any>>,
  Owner extends keyof Tables,
  Target extends keyof Tables
> {
  ownerField: ScalarPath<Tables[Owner]["schema"]>;
  targetTableName: Target;
  targetField: ScalarKeys<Tables[Target]["schema"]>;
}

/** @internal */
export type RelationsConfig<
  Tables extends Record<string, TableConfig<any, any, any>>
> = {
    [K in keyof Tables & string]?: Array<
      {
        [Target in keyof Tables & string]: RelationEntry<
          Tables,
          K,
          Target
        >;
      }[keyof Tables & string]
    >;
  };

// ─── Materialized types ───────────────────────────────────────────────────────

/** @internal */
export type ScalarMergeNames<
  Rels extends readonly TypedRelation[],
  Owner extends string
> = Extract<
  Rels[number],
  { ownerTable: Owner; kind: "scalar" }
> extends TypedRelation<any, any, any, any, any, infer A>
  ? A extends string
  ? A
  : never
  : never;

/** @internal */
export type ScalarMergeType<
  Tables extends Record<string, TableConfig<any, any, any>>,
  Rels extends readonly TypedRelation[],
  Owner extends string,
  Name extends string
> = Extract<
  Rels[number],
  { ownerTable: Owner; kind: "scalar"; as: Name }
> extends TypedRelation<any, any, infer TT, any, any, any>
  ? TT extends keyof Tables
  ? Infer<Tables[TT]["schema"]> | null
  : never
  : never;

/** @internal */
export type ScalarMerge<
  Tables extends Record<string, TableConfig<any, any, any>>,
  Rels extends readonly TypedRelation[],
  Owner extends string
> = {
    [K in ScalarMergeNames<Rels, Owner>]: ScalarMergeType<
      Tables,
      Rels,
      Owner,
      K
    >;
  };

/** @internal */
export type SubMergeNames<
  Rels extends readonly TypedRelation[],
  Owner extends string,
  Sub extends string
> = Extract<
  Rels[number],
  { ownerTable: Owner; kind: "subTable"; ownerField: `${Sub}.${string}` }
> extends TypedRelation<any, any, any, any, any, infer A>
  ? A extends string
  ? A
  : never
  : never;

/** @internal */
export type SubMergeType<
  Tables extends Record<string, TableConfig<any, any, any>>,
  Rels extends readonly TypedRelation[],
  Owner extends string,
  Sub extends string,
  Name extends string
> = Extract<
  Rels[number],
  { ownerTable: Owner; kind: "subTable"; ownerField: `${Sub}.${string}`; as: Name }
> extends TypedRelation<any, any, infer TT, any, any, any>
  ? TT extends keyof Tables
  ? Infer<Tables[TT]["schema"]> | null
  : never
  : never;

/** @internal */
export type SubMerge<
  Tables extends Record<string, TableConfig<any, any, any>>,
  Rels extends readonly TypedRelation[],
  Owner extends string,
  Sub extends string
> = {
    [K in SubMergeNames<Rels, Owner, Sub>]: SubMergeType<
      Tables,
      Rels,
      Owner,
      Sub,
      K
    >;
  };

/**
 * Entity with resolved relations. Sub-table arrays get their related entities
 * merged in, and scalar relations appear as direct properties.
 *
 * @example
 * ```ts
 * // Given: OrderSchema with lineItems: Array<{ sku: string; qty: number }>
 * // And a relation: lineItems.sku → products.sku (as "product")
 *
 * type M = Materialized<OrderSchema, Tables, Rels, "orders">;
 * // M.lineItems becomes Array<{ sku: string; qty: number; product: Product | null }>
 * // M also gets scalar relation properties like `.related` accessors
 * ```
 * @category Relations
 */
export type Materialized<
  T extends TObject,
  Tables extends Record<string, TableConfig<any, any, any>>,
  Rels extends readonly TypedRelation[],
  Owner extends string
> = {
  [K in keyof Infer<T>]: K extends string
  ? Infer<T>[K] extends Array<infer Item>
  ? Array<Item & SubMerge<Tables, Rels, Owner, K>>
  : Infer<T>[K]
  : Infer<T>[K];
} & ScalarMerge<Tables, Rels, Owner>;

// ─── Result types ─────────────────────────────────────────────────────────────

/** paginated query result */
export interface PageResult<T> {
  data: T[];
  total: number;
  limit: number;
  offset: number;
}

// ─── Upsert ───────────────────────────────────────────────────────────────────

/** insert or update on conflict */
export interface UpsertOptions<T extends TObject, PK extends ScalarKeys<T>> {
  data: InsertData<T>;
  conflictTarget: PK | PK[];
  /** columns to update on conflict - defaults to all non-pk columns */
  update?: Array<ScalarKeys<T>>;
}

// ─── Migration types ──────────────────────────────────────────────────────────

/** a single migration step */
export interface Migration {
  name: string;
  date: string;
  up: (db: import("./database.ts").BunDatabase) => void;
  down?: (db: import("./database.ts").BunDatabase) => void;
}

/** options for migrate() */
export interface MigrateOptions {
  path: string;
  migrationsDir: string;
  direction?: "up";
  target?: string;
}

/** @internal */
export type SchemaChange =
  | { kind: "add-table"; table: string }
  | { kind: "add-column"; table: string; column: { name: string; sqlType: string; nullable: boolean; optional: boolean }; hasDefault: boolean }
  | { kind: "add-index"; table: string; index: { name: string; unique: number; columns: string[] } }
  | { kind: "add-subtable"; table: string; subTable: { fieldName: string; tableName: string; columns: { name: string; sqlType: string; nullable: boolean; optional: boolean }[] } }
  | { kind: "drop-column"; table: string; column: string }
  | { kind: "rename-column"; table: string; from: string; to: string }
  | { kind: "change-type"; table: string; column: string; from: string; to: string }
  | { kind: "change-nullable"; table: string; column: string; to: boolean }
  | { kind: "drop-table"; table: string }
  | { kind: "change-pk"; table: string }
  | { kind: "drop-index"; table: string; index: { name: string; unique: number; columns: string[] } };

/** @internal */
export interface SchemaDiff {
  safe: SchemaChange[];
  unsafe: SchemaChange[];
}

/** how to handle schema drift on startup */
export type SyncPolicy =
  | "ignore"
  | "warn"
  | "error"
  | "auto"
  | ((diff: SchemaDiff, db: import("./database.ts").BunDatabase) => boolean | void);

// ─── Event types ──────────────────────────────────────────────────────────────

/** specific operations that can be listened to per table */
export type TableOperation =
  | "insert"
  | "insertMany"
  | "update"
  | "delete"
  | "deleteWhere"
  | "upsert"
  | "findById"
  | "findMany"
  | "findOne"
  | "findPage"
  | "count"
  | "flush";

/** broad categories for event listening */
export type BroadOperation = "read" | "write" | "delete";

/** @internal */
export type TableEventOperation = TableOperation | BroadOperation;

/** payload delivered to event listeners */
export interface TableEventPayload<
  T = unknown,
  Op extends TableEventOperation = TableEventOperation
> {
  table: string;
  operation: Op;
  data?: T | T[] | Partial<T> | Record<string, unknown>;
  result?: T | T[] | PageResult<T> | number | null;
  id?: unknown;
  where?: unknown;
  options?: unknown;
  timestamp: number;
}

// ─── Lifecycle config primitives ──────────────────────────────────────────────

/** how to handle errors */
export type ErrorPolicy = "throw" | "emit" | "emit-swallow" | "crash";

/** when to delete db files on shutdown */
export type UnlinkPolicy = true | "onlyGraceful" | "any" | false | undefined;
