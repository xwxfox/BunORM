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
} from "typebox";
import type { ColumnRef, TScalarSchema } from "./columns.ts";
import type { TypedRelation } from "./typed-relation.ts";

// ─── Primitive column types ──────────────────────────────────────────────────

export type SqliteScalar = string | number | boolean | null | bigint;

// ─── Schema introspection helpers ────────────────────────────────────────────

/** Extract only the scalar properties from a TObject's properties map */
export type ScalarProperties<P extends TProperties> = {
  [K in keyof P as P[K] extends TArray<infer _> ? never : K]: P[K];
};

/** Extract only the array-of-object properties (sub-tables) */
export type ArrayOfObjectProperties<P extends TProperties> = {
  [K in keyof P as P[K] extends TArray<TObject>
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

/** Scalar keys of a sub-table item schema */
export type SubTableItemKeys<
  T extends TObject,
  K extends SubTableKeys<T>
> = T["properties"][K] extends TArray<infer Item>
  ? Item extends TObject
    ? ScalarKeys<Item>
    : never
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

export interface IndexDefinition {
  name?: string;
  columns: ColumnRef<string, TScalarSchema>[];
  unique?: boolean;
}

// ─── Entity helper ───────────────────────────────────────────────────────────

export type Entity<T, Mat = never> = [Mat] extends [never]
  ? T & { createdAt?: number; updatedAt?: number }
  : T & { createdAt?: number; updatedAt?: number } & { materialize(): Mat };

// ─── Table config (what users pass per table in `createORM`) ─────────────────

export interface TableConfig<
  T extends TObject = TObject,
  PK extends string = string
> {
  schema: T;
  primaryKey: ColumnRef<PK>;
  indexes?: IndexDefinition[];
  subTables?: Partial<Record<string, { indexes?: IndexDefinition[] }>>;
  timestamps?: true | { createdAt?: string; updatedAt?: string };
}

// ─── Relations ────────────────────────────────────────────────────────────────

/** Runtime shape of a built relation (legacy) */
export interface BuiltRelation {
  ownerTable: string;
  ownerField: string;
  targetTable: string;
  targetField: string;
  as?: string;
  kind: "scalar" | "subTable";
}

/** Legacy object-based relations config (kept for backward compat) */
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

// ─── Materialized types ───────────────────────────────────────────────────────

/** Extract names of scalar direct-merge relations for a table */
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

/** Type of a specific scalar direct-merge relation */
export type ScalarMergeType<
  Tables extends Record<string, TableConfig>,
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

/** Scalar direct-merge properties added to materialized entity */
export type ScalarMerge<
  Tables extends Record<string, TableConfig>,
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

/** Extract names of sub-table direct-merge relations for a table+sub-field */
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

/** Type of a specific sub-table direct-merge relation */
export type SubMergeType<
  Tables extends Record<string, TableConfig>,
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

/** Sub-table direct-merge properties added to array items */
export type SubMerge<
  Tables extends Record<string, TableConfig>,
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

/** Full materialized entity type for a table */
export type Materialized<
  T extends TObject,
  Tables extends Record<string, TableConfig>,
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
