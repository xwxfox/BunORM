/**
 * bunorm/src/types.ts
 * Core type utilities — all ORM-level TypeScript types live here.
 * Zero runtime cost; pure compile-time machinery.
 */

import type {
  TObject,
  TArray,
  TSchema,
  TProperties,
  Static,
  TString,
  TNumber,
  TInteger,
  TBoolean,
  TLiteral,
} from "typebox";

// ─── Primitive column types ──────────────────────────────────────────────────

export type SqliteScalar = string | number | boolean | null | bigint;

/** Typebox schemas that map to a single SQLite column */
export type TScalarSchema =
  | TString
  | TNumber
  | TInteger
  | TBoolean
  | TLiteral<string>
  | TLiteral<number>
  | TLiteral<boolean>;

// ─── Schema introspection helpers ────────────────────────────────────────────

/** Extract only the scalar properties from a TObject's properties map */
export type ScalarProperties<P extends TProperties> = {
  [K in keyof P as P[K] extends TArray<infer _> ? never : K]: P[K];
};

/** Extract only the array-of-object properties (sub-tables) */
export type ArrayOfObjectProperties<P extends TProperties> = {
  [K in keyof P as P[K] extends TArray<TObject<infer _>>
    ? K
    : never]: P[K] extends TArray<infer Item> ? Item : never;
};

/** All flat column keys of a TObject schema */
export type ScalarKeys<T extends TObject> =
  keyof ScalarProperties<T["properties"]> & string;

/** All sub-table keys of a TObject schema */
export type SubTableKeys<T extends TObject> =
  keyof ArrayOfObjectProperties<T["properties"]> & string;

/** Valid dot-path into a sub-table array, e.g. "lineItems.itemNumber" */
export type SubTableScalarPath<T extends TObject> = {
  [K in SubTableKeys<T>]: T["properties"][K] extends TArray<infer Item>
    ? Item extends TObject
      ? `${K}.${ScalarKeys<Item>}`
      : never
    : never;
}[SubTableKeys<T>];

/** Any valid scalar column or dot-path into a sub-table */
export type ScalarPath<T extends TObject> =
  | ScalarKeys<T>
  | SubTableScalarPath<T>;

// ─── Static inference shortcuts ──────────────────────────────────────────────

/** The full hydrated TypeScript type of a schema */
export type Infer<T extends TSchema> = Static<T>;

/** The row type stored in the DB (scalars only, arrays become separate tables) */
export type FlatRow<T extends TObject> = {
  [K in ScalarKeys<T>]: Static<T["properties"][K]>;
};

/** Sub-table item type for a given array field */
export type SubTableItem<
  T extends TObject,
  K extends SubTableKeys<T>
> = T["properties"][K] extends TArray<infer Item extends TSchema>
  ? Static<Item>
  : never;

// ─── Filter / Where types ─────────────────────────────────────────────────────

type ScalarFilter<V> = V extends string
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

/** Typed WHERE clause — only flat/scalar columns are filterable */
export type WhereClause<T extends TObject> = {
  [K in ScalarKeys<T>]?: ScalarFilter<Static<T["properties"][K]>>;
};

// ─── OrderBy ─────────────────────────────────────────────────────────────────

export type OrderByClause<T extends TObject> = {
  column: ScalarKeys<T>;
  direction?: "ASC" | "DESC";
};

// ─── Pagination ───────────────────────────────────────────────────────────────

export interface PaginationOptions {
  limit?: number;
  offset?: number;
}

// ─── Query options ────────────────────────────────────────────────────────────

export interface FindOptions<T extends TObject> extends PaginationOptions {
  where?: WhereClause<T>;
  orderBy?: OrderByClause<T> | OrderByClause<T>[];
  include?: SubTableKeys<T>[];
}

// ─── Insert / Update ──────────────────────────────────────────────────────────

/** Full record to insert (full Infer<T>) */
export type InsertData<T extends TObject> = Infer<T>;

/** Partial for updates — must include PK */
export type UpdateData<T extends TObject, PK extends ScalarKeys<T>> = Pick<
  Infer<T>,
  PK
> &
  Partial<Omit<Infer<T>, PK>>;

// ─── Index definition ────────────────────────────────────────────────────────

export interface IndexDefinition<T extends TObject> {
  name?: string;
  columns: ScalarKeys<T>[];
  unique?: boolean;
}

// ─── Table config (what users pass per table in `createORM`) ─────────────────

export interface TableConfig<
  T extends TObject = TObject,
  PK extends string = string
> {
  schema: T;
  primaryKey: PK;
  indexes?: IndexDefinition<T>[];
}

// ─── Relations ────────────────────────────────────────────────────────────────

/** A single validated cross-table relation */
export interface RelationEntry<
  Tables extends Record<string, TableConfig>,
  Owner extends keyof Tables,
  Target extends keyof Tables
> {
  ownerField: ScalarPath<Tables[Owner]["schema"]>;
  targetTableName: Target;
  targetField: ScalarKeys<Tables[Target]["schema"]>;
}

/** Top-level relations config — each key is an owner table name */
export type RelationsConfig<
  Tables extends Record<string, TableConfig>
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

// ─── Result types ─────────────────────────────────────────────────────────────

export interface PageResult<T> {
  data: T[];
  total: number;
  limit: number;
  offset: number;
}

// ─── Upsert ───────────────────────────────────────────────────────────────────

export interface UpsertOptions<T extends TObject, PK extends ScalarKeys<T>> {
  data: InsertData<T>;
  conflictTarget: PK | PK[];
  /** Which columns to update on conflict — defaults to all non-PK columns */
  update?: Array<ScalarKeys<T>>;
}
