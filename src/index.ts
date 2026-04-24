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

// Metadata store
export { MetaStore } from "./meta.ts";

// Timestamps
export { resolveTimestampNames, DEFAULT_TIMESTAMP_NAMES } from "./timestamps.ts";
export type { TimestampConfig } from "./timestamps.ts";

// Inspector
export { inspectSchema, inspectAllTables } from "./inspector.ts";
export type { InspectorTable, InspectorColumn, InspectorIndex } from "./inspector.ts";

// Diff
export { computeDiff } from "./diff.ts";
export type { DesiredTable } from "./diff.ts";

// Sync
export { applySync } from "./sync.ts";

// Migrate
export { migrate } from "./migrate.ts";
export { createMigration } from "./migration-template.ts";

// Migration types
export type {
  Migration,
  MigrateOptions,
  SchemaDiff,
  SchemaChange,
  SyncPolicy,
} from "./types.ts";

// Event system
export { EventBus } from "./events.ts";
export type { TableEventPayload, TableOperation, BroadOperation } from "./types.ts";

// Lifecycle
export { LifecycleManager } from "./lifecycle.ts";
export type { ORMContext, LifecycleHook } from "./lifecycle.ts";

// Errors
export { ORMError, raise, withTrace } from "./errors.ts";
export type { ORMErrorContext, TraceEntry } from "./errors.ts";

// QoL types
export type { ErrorPolicy, UnlinkPolicy } from "./types.ts";
