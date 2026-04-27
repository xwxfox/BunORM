/**
 * bunorm — typed sqlite orm backed by typebox
 *
 * ```ts
 * import { createORM, table } from "bunorm";
 * import { Object, String } from "typebox";
 *
 * const orm = createORM({
 *   tables: {
 *     users: table(Object({ id: String(), name: String() }), s => ({
 *       primaryKey: s.id
 *     }))
 *   }
 * });
 *
 * orm.users.insert({ id: "1", name: "alice" });
 * const user = orm.users.findById("1");
 * ```
 */

export { createORM } from "./orm.ts";
export type { BunORM, CreateORMOptions, CreateORMBaseOptions } from "./orm.ts";

export { BunDatabase } from "./database.ts";
export { Repository } from "./repository.ts";

export type {
  Infer,
  WhereClause,
  OrderByClause,
  FindOptions,
  InsertData,
  UpdateData,
  UpsertOptions,
  PageResult,
  TableConfig,
  IndexDefinition,
  TableOperation,
  BroadOperation,
  TableEventPayload,
  ErrorPolicy,
  UnlinkPolicy,
} from "./types.ts";

export { table } from "./table.ts";
export type { TableDescriptor, SubTableConfig } from "./table.ts";

export type { ColumnRef, ColumnRefs, TScalarSchema } from "./columns.ts";

export { createRelationBuilder } from "./relations.ts";
export type { RelationBuilder } from "./relations.ts";
export type { TypedRelation } from "./typed-relation.ts";

export { introspectTable, buildCreateTableSQL } from "./schema.ts";
export { MetaStore } from "./meta.ts";
export { resolveTimestampNames, DEFAULT_TIMESTAMP_NAMES } from "./timestamps.ts";
export type { TimestampConfig } from "./timestamps.ts";

export { inspectSchema, inspectAllTables } from "./inspector.ts";
export type { InspectorTable, InspectorColumn, InspectorIndex } from "./inspector.ts";

export { computeDiff } from "./diff.ts";
export type { DesiredTable } from "./diff.ts";

export { applySync } from "./sync.ts";

export { migrate } from "./migrate.ts";
export { createMigration } from "./migration-template.ts";
export type { Migration, MigrateOptions, SchemaDiff, SchemaChange, SyncPolicy } from "./types.ts";

export { EventBus } from "./events.ts";
export type { LifecycleEventMap, ORMEvents } from "./events.ts";

export { LifecycleManager } from "./lifecycle.ts";
export type { ORMContext, LifecycleHook } from "./lifecycle.ts";

export { ORMError, raise, withTrace } from "./errors.ts";
export type { ORMErrorContext, TraceEntry } from "./errors.ts";
