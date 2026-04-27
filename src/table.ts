/**
 * bunorm/src/table.ts
 * User-facing helper that wraps a schema + configuration into a descriptor.
 * Guarantees compile-time safety for PK and index columns via ColumnRef.
 */

import type { TObject } from "typebox";
import type { ColumnRef, TScalarSchema, ColumnRefs } from "./columns.ts";
import { createColumnProxy } from "./columns.ts";
import type { IndexDefinition, TimestampConfig, TableConfig } from "./types.ts";

export interface SubTableConfig {
  indexes?: IndexDefinition[];
}

export interface TableDescriptor<
  T extends TObject,
  PK extends string,
  TS extends TimestampConfig = undefined
> extends TableConfig<T, PK, TS> {}

/** @internal */
interface TableConfigShape<PK extends string, TS extends TimestampConfig> {
  primaryKey: ColumnRef<PK>;
  indexes?: IndexDefinition[];
  subTables?: Partial<Record<string, SubTableConfig>>;
  timestamps?: TS;
}

/** describe a table schema + config for createORM */
export function table<
  T extends TObject,
  PK extends string,
  const TS extends boolean
>(
  schema: T,
  configure: (columns: ColumnRefs<T>) => TableConfigShape<PK, TS> & { timestamps: TS }
): TableDescriptor<T, PK, TS>;

export function table<
  T extends TObject,
  PK extends string,
  const TS extends { createdAt?: string; updatedAt?: string }
>(
  schema: T,
  configure: (columns: ColumnRefs<T>) => TableConfigShape<PK, TS> & { timestamps: TS }
): TableDescriptor<T, PK, TS>;

export function table<
  T extends TObject,
  PK extends string
>(
  schema: T,
  configure: (columns: ColumnRefs<T>) => TableConfigShape<PK, undefined>
): TableDescriptor<T, PK, undefined>;

export function table<
  T extends TObject,
  PK extends string,
  TS extends TimestampConfig
>(
  schema: T,
  configure: (columns: ColumnRefs<T>) => TableConfigShape<PK, TS>
): TableDescriptor<T, PK, TS> {
  const columns = createColumnProxy(schema);
  const config = configure(columns);
  return { schema, ...config };
}
