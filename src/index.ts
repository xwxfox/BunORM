/**
 * bunorm — public API surface
 */

// ORM entry point
export { createORM } from "./orm.ts";
export type { BunORM, CreateORMOptions, CreateORMBaseOptions } from "./orm.ts";

// Database
export { BunDatabase } from "./database.ts";

// Repository
export { Repository } from "./repository.ts";

// Type helpers
export type {
  Infer,
  FlatRow,
  SubTableItem,
  WhereClause,
  OrderByClause,
  FindOptions,
  InsertData,
  UpdateData,
  UpsertOptions,
  PageResult,
  TableConfig,
  IndexDefinition,
  RelationEntry,
  RelationsConfig,
  PaginationOptions,
  ScalarPath,
} from "./types.ts";

// Table helper
export { table } from "./table.ts";
export type { TableDescriptor, SubTableConfig } from "./table.ts";

// Column refs
export type { ColumnRef, ColumnRefs, TScalarSchema } from "./columns.ts";

// Relations builder
export { createRelationBuilder } from "./relations.ts";
export type { RelationBuilder } from "./relations.ts";

// Typed relation
export type { TypedRelation } from "./typed-relation.ts";

// Schema utilities (for advanced use)
export { introspectTable, buildCreateTableSQL } from "./schema.ts";
