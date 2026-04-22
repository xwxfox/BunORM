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

// Schema utilities (for advanced use)
export { introspectTable, buildCreateTableSQL } from "./schema.ts";
