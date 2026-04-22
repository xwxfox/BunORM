/**
 * bunorm/src/orm.ts
 * Top-level ORM — creates repositories, manages cross-table relations,
 * and exposes the materializer for eager loading.
 */

import type { TObject } from "typebox";
import type { ScalarKeys, TableConfig, RelationsConfig } from "./types.ts";
import { BunDatabase } from "./database.ts";
import { Repository } from "./repository.ts";
import { introspectTable } from "./schema.ts";

// ─── Options ──────────────────────────────────────────────────────────────────

export interface CreateORMBaseOptions {
  path?: string;
  cacheSize?: number;
  busyTimeout?: number;
  synchronous?: "OFF" | "NORMAL" | "FULL" | "EXTRA";
  mmapSize?: number;
}

export interface CreateORMOptions<
  T extends Record<string, TableConfig> = Record<string, TableConfig>
> extends CreateORMBaseOptions {
  tables: T;
  relations?: RelationsConfig<T>;
}

// ─── Relation registry ────────────────────────────────────────────────────────

interface RegisteredRelation {
  ownerTable: string;
  ownerField: string; // dot-path, e.g. "lineItems.itemNumber"
  targetTable: string;
  targetField: string;
}

// ─── ORM return type ──────────────────────────────────────────────────────────

export type BunORM<Tables extends Record<string, TableConfig>> = {
  [K in keyof Tables]: Repository<
    Tables[K]["schema"],
    Tables[K]["primaryKey"] extends ScalarKeys<Tables[K]["schema"]>
      ? Tables[K]["primaryKey"]
      : never
  >;
} & {
  transaction<R>(fn: () => R): R;
  close(): void;
  materialize<Owner extends keyof Tables & string>(
    ownerTable: Owner,
    record: Record<string, unknown>
  ): Record<string, unknown>;
  materializeMany<Owner extends keyof Tables & string>(
    ownerTable: Owner,
    records: Record<string, unknown>[]
  ): Array<Record<string, unknown>>;
};

// ─── Factory ──────────────────────────────────────────────────────────────────

export function createORM<const T extends Record<string, TableConfig>>(
  opts: CreateORMOptions<T>
): BunORM<T> {
  const db = new BunDatabase(opts);

  // Validate tables object
  const tableEntries = Object.entries(opts.tables);
  if (tableEntries.length === 0) {
    throw new Error("bunorm: at least one table must be defined in `tables`");
  }

  // Create repositories with eager validation
  const repos = new Map<string, Repository<TObject, string>>();

  for (const [name, config] of tableEntries) {
    const meta = introspectTable(name, config.schema);
    const colNames = new Set(meta.columns.map((c) => c.name));

    // Validate primaryKey
    if (!colNames.has(config.primaryKey)) {
      throw new Error(
        `bunorm: primary key "${config.primaryKey}" is not a scalar column in table "${name}"`
      );
    }

    // Validate indexes
    for (const idx of config.indexes ?? []) {
      for (const col of idx.columns) {
        if (!colNames.has(col)) {
          throw new Error(
            `bunorm: index column "${col}" not found in table "${name}"`
          );
        }
      }
    }

    const repo = new Repository(name, config, db);
    repos.set(name, repo as Repository<TObject, string>);
  }

  // Register and validate relations
  const relations: RegisteredRelation[] = [];

  for (const [ownerTable, rels] of Object.entries(opts.relations ?? {})) {
    if (!rels) continue;

    const ownerRepo = repos.get(ownerTable);
    if (!ownerRepo) {
      throw new Error(
        `bunorm: relation owner table "${ownerTable}" not found in tables`
      );
    }

    for (const rel of rels) {
      const targetRepo = repos.get(rel.targetTableName);
      if (!targetRepo) {
        throw new Error(
          `bunorm: relation target table "${rel.targetTableName}" not found in tables`
        );
      }

      // Validate ownerField
      const parts = rel.ownerField.split(".");
      if (parts.length === 1) {
        const [col = ""] = parts;
        const ownerCols = new Set(ownerRepo.meta.columns.map((c) => c.name));
        if (!ownerCols.has(col)) {
          throw new Error(
            `bunorm: relation ownerField "${rel.ownerField}" is not a scalar column in table "${ownerTable}"`
          );
        }
      } else if (parts.length === 2) {
        const [subField = "", subCol = ""] = parts;
        const sub = ownerRepo.meta.subTables.find(
          (st) => st.fieldName === subField
        );
        if (!sub) {
          throw new Error(
            `bunorm: relation ownerField "${rel.ownerField}" references unknown sub-table "${subField}" in table "${ownerTable}"`
          );
        }
        const subCols = new Set(sub.columns.map((c) => c.name));
        if (!subCols.has(subCol)) {
          throw new Error(
            `bunorm: relation ownerField "${rel.ownerField}" references unknown column "${subCol}" in sub-table "${subField}" of table "${ownerTable}"`
          );
        }
      } else {
        throw new Error(
          `bunorm: relation ownerField "${rel.ownerField}" has too many dot segments (max 2 allowed)`
        );
      }

      // Validate targetField
      const targetCols = new Set(targetRepo.meta.columns.map((c) => c.name));
      if (!targetCols.has(rel.targetField)) {
        throw new Error(
          `bunorm: relation targetField "${rel.targetField}" is not a scalar column in table "${rel.targetTableName}"`
        );
      }

      relations.push({
        ownerTable,
        ownerField: rel.ownerField,
        targetTable: rel.targetTableName,
        targetField: rel.targetField,
      });
    }
  }

  // ─── Materializer closures ──────────────────────────────────────────────────

  function materialize(
    ownerTable: string,
    record: Record<string, unknown>
  ): Record<string, unknown> {
    const rels = relations.filter((r) => r.ownerTable === ownerTable);
    if (rels.length === 0) return record;

    const result = { ...record };

    for (const rel of rels) {
      const parts = rel.ownerField.split(".");

      if (parts.length === 1) {
        // Direct scalar FK on the main record
        const col = parts[0] as string;
        const fkVal = result[col];
        if (fkVal !== null && fkVal !== undefined) {
          const targetRepo = repos.get(rel.targetTable);
          if (targetRepo) {
            const found = targetRepo.raw(
              `SELECT * FROM "${rel.targetTable}" WHERE "${rel.targetField}" = ? LIMIT 1`,
              fkVal
            )[0];
            result[`_${col}_resolved`] = found ?? null;
          }
        }
      } else if (parts.length === 2) {
        // FK lives inside a sub-array: e.g. "lineItems.itemNumber"
        const arrayField = parts[0] as string;
        const fkField = parts[1] as string;
        const items = result[arrayField];
        if (globalThis.Array.isArray(items)) {
          const targetRepo = repos.get(rel.targetTable);
          if (!targetRepo) continue;

          // Batch: collect all FK values and fetch in one query
          const fkValues = items
            .map((item) => (item as Record<string, unknown>)[fkField])
            .filter((v) => v !== null && v !== undefined);

          if (fkValues.length === 0) continue;

          const placeholders = fkValues.map(() => "?").join(", ");
          const fetched = targetRepo.raw<Record<string, unknown>>(
            `SELECT * FROM "${rel.targetTable}" WHERE "${rel.targetField}" IN (${placeholders})`,
            ...fkValues
          );

          const byKey = new Map<unknown, Record<string, unknown>>();
          for (const row of fetched) {
            byKey.set(row[rel.targetField], row);
          }

          result[arrayField] = items.map((item) => ({
            ...(item as Record<string, unknown>),
            _resolved: byKey.get(
              (item as Record<string, unknown>)[fkField]
            ) ?? null,
          }));
        }
      }
    }

    return result;
  }

  function materializeMany(
    ownerTable: string,
    records: Record<string, unknown>[]
  ): Array<Record<string, unknown>> {
    if (records.length === 0) return [];

    const rels = relations.filter((r) => r.ownerTable === ownerTable);
    if (rels.length === 0) return records;

    // Deep-copy records
    const results = records.map((r) => ({ ...r }));

    for (const rel of rels) {
      const parts = rel.ownerField.split(".");
      const targetRepo = repos.get(rel.targetTable);
      if (!targetRepo) continue;

      if (parts.length === 1) {
        // Batch scalar FK
        const col = parts[0] as string;
        const fkValues = [
          ...new Set(
            results
              .map((r) => r[col])
              .filter((v) => v !== null && v !== undefined)
          ),
        ];
        if (fkValues.length === 0) continue;
        const ph = fkValues.map(() => "?").join(", ");
        const fetched = targetRepo.raw<Record<string, unknown>>(
          `SELECT * FROM "${rel.targetTable}" WHERE "${rel.targetField}" IN (${ph})`,
          ...fkValues
        );
        const byKey = new Map(fetched.map((r) => [r[rel.targetField], r]));
        for (const rec of results) {
          rec[`_${col}_resolved`] = byKey.get(rec[col]) ?? null;
        }
      } else if (parts.length === 2) {
        const arrayField = parts[0] as string;
        const fkField = parts[1] as string;
        const allFkValues = [
          ...new Set(
            results.flatMap((r) => {
              const items = r[arrayField];
              if (!globalThis.Array.isArray(items)) return [];
              return items
                .map((i) => (i as Record<string, unknown>)[fkField])
                .filter((v) => v !== null && v !== undefined);
            })
          ),
        ];
        if (allFkValues.length === 0) continue;
        const ph = allFkValues.map(() => "?").join(", ");
        const fetched = targetRepo.raw<Record<string, unknown>>(
          `SELECT * FROM "${rel.targetTable}" WHERE "${rel.targetField}" IN (${ph})`,
          ...allFkValues
        );
        const byKey = new Map(fetched.map((r) => [r[rel.targetField], r]));

        for (const rec of results) {
          const items = rec[arrayField];
          if (!globalThis.Array.isArray(items)) continue;
          rec[arrayField] = items.map((item) => ({
            ...(item as Record<string, unknown>),
            _resolved: byKey.get(
              (item as Record<string, unknown>)[fkField]
            ) ?? null,
          }));
        }
      }
    }

    return results;
  }

  // ─── Build accessor object with getters ─────────────────────────────────────

  const accessors = {} as BunORM<T>;

  for (const name of Object.keys(opts.tables)) {
    Object.defineProperty(accessors, name, {
      get() {
        return repos.get(name)!;
      },
      enumerable: true,
      configurable: true,
    });
  }

  Object.assign(accessors, {
    transaction: db.transaction.bind(db),
    close: db.close.bind(db),
    materialize,
    materializeMany,
  });

  return accessors;
}
