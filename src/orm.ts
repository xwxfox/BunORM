/**
 * bunorm/src/orm.ts
 * Top-level ORM — creates repositories, manages cross-table relations,
 * and exposes the materializer for eager loading.
 */

import type { TObject } from "typebox";
import type {
  ScalarKeys,
  TableConfig,
  RelationsConfig,
  Materialized,
  Entity,
  MetaAccessors,
  TimestampShape,
} from "./types.ts";
import type { TypedRelation } from "./typed-relation.ts";
import { BunDatabase } from "./database.ts";
import { Repository } from "./repository.ts";
import { introspectTable } from "./schema.ts";
import { createRelationBuilder, type RelationBuilder } from "./relations.ts";
import { MetaStore } from "./meta.ts";

// ─── Options ──────────────────────────────────────────────────────────────────

export interface CreateORMBaseOptions {
  path?: string;
  cacheSize?: number;
  busyTimeout?: number;
  synchronous?: "OFF" | "NORMAL" | "FULL" | "EXTRA";
  mmapSize?: number;
}

export interface CreateORMOptions<
  T extends Record<string, TableConfig> = Record<string, TableConfig>,
  Rels extends readonly TypedRelation[] = readonly TypedRelation[]
> extends CreateORMBaseOptions {
  tables: T;
  relations?: RelationsConfig<any> | ((builder: RelationBuilder<T>) => Rels);
}

// ─── ORM return type ──────────────────────────────────────────────────────────

export type BunORM<
  Tables extends Record<string, TableConfig>,
  Rels extends readonly TypedRelation[] = readonly TypedRelation[]
> = {
  [K in keyof Tables]: Repository<
    Tables[K]["schema"],
    Tables[K]["primaryKey"]["name"] extends ScalarKeys<Tables[K]["schema"]>
      ? Tables[K]["primaryKey"]["name"]
      : never,
    Materialized<Tables[K]["schema"], Tables, Rels, K & string>,
    TimestampShape<Tables[K]["timestamps"]>
  >;
} & {
  transaction<R>(fn: () => R): R;
  close(): void;
  meta: MetaAccessors;
  materialize<Owner extends keyof Tables & string>(
    ownerTable: Owner,
    record: Record<string, unknown>
  ): Record<string, unknown>;
  materializeMany<Owner extends keyof Tables & string>(
    ownerTable: Owner,
    records: Record<string, unknown>[]
  ): Array<Record<string, unknown>>;
  flush(opts?: { includeMeta?: boolean }): void;
};

// ─── Factory ──────────────────────────────────────────────────────────────────

export function createORM<
  const T extends Record<string, TableConfig>,
  const Rels extends readonly TypedRelation[] = readonly TypedRelation[]
>(opts: CreateORMOptions<T, Rels>): BunORM<T, Rels> {
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
    const pkName = config.primaryKey.name;
    if (!colNames.has(pkName)) {
      throw new Error(
        `bunorm: primary key "${pkName}" is not a scalar column in table "${name}"`
      );
    }

    // Validate indexes
    for (const idx of config.indexes ?? []) {
      for (const colRef of idx.columns) {
        if (!colNames.has(colRef.name)) {
          throw new Error(
            `bunorm: index column "${colRef.name}" not found in table "${name}"`
          );
        }
      }
    }

    const repo = new Repository(name, config, db);
    repos.set(name, repo as Repository<TObject, string>);
  }

  // Register and validate relations
  const relations: TypedRelation[] = [];

  if (typeof opts.relations === "function") {
    const builder = createRelationBuilder(opts.tables);
    const built = opts.relations(builder);
    for (const rel of built) {
      relations.push(rel);
    }
  } else {
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
          kind: parts.length === 1 ? "scalar" : "subTable",
          as: undefined,
        });
      }
    }
  }

  // ─── Persist metadata ───────────────────────────────────────────────────────

  const meta = new MetaStore(db);

  const allSchemas = Object.fromEntries(
    tableEntries.map(([name, config]) => [name, config.schema])
  );
  const schemaJson = JSON.stringify(allSchemas);
  const schemaHash = Bun.hash(schemaJson);
  const schemaBytes = new TextEncoder().encode(schemaJson);

  meta.setString("_schema_hash", String(schemaHash));
  meta.setCompressed("_schema_compressed", schemaBytes);
  meta.setJSON("_tables", Object.keys(opts.tables));
  meta.setJSON("_relations", relations);
  meta.setString("_bunorm_version", "0.0.2");

  // ─── Build and inject materializers ─────────────────────────────────────────

  function buildLazyResolver(
    ownerTable: string,
    record: Record<string, unknown>
  ) {
    const rels = relations.filter((r) => r.ownerTable === ownerTable);
    if (rels.length === 0) return undefined;

    return (relationName: string) => {
      const rel = rels.find(
        (r) => r.as === relationName || r.ownerField === relationName
      );
      if (!rel) return undefined;

      const targetRepo = repos.get(rel.targetTable);
      if (!targetRepo) return null;

      if (rel.kind === "scalar") {
        const fkVal = record[rel.ownerField];
        if (fkVal == null) return null;
        const found = targetRepo.raw(
          `SELECT * FROM "${rel.targetTable}" WHERE "${rel.targetField}" = ? LIMIT 1`,
          fkVal
        )[0];
        return found ?? null;
      }

      if (rel.kind === "subTable") {
        const [subField, fkField] = rel.ownerField.split(".") as [string, string];
        const items = record[subField];
        if (!globalThis.Array.isArray(items)) return [];
        const fkValues = items
          .map((item: unknown) => (item as Record<string, unknown>)[fkField])
          .filter((v) => v != null);
        if (fkValues.length === 0) return [];
        const ph = fkValues.map(() => "?").join(", ");
        const fetched = targetRepo.raw<Record<string, unknown>>(
          `SELECT * FROM "${rel.targetTable}" WHERE "${rel.targetField}" IN (${ph})`,
          ...fkValues
        );
        const byKey = new Map(fetched.map((r) => [r[rel.targetField], r]));
        return items.map((item: unknown) => ({
          ...(item as Record<string, unknown>),
          _resolved: byKey.get((item as Record<string, unknown>)[fkField]) ?? null,
        }));
      }

      return undefined;
    };
  }

  function materialize(
    ownerTable: string,
    record: Record<string, unknown>
  ): Record<string, unknown> {
    const tableRels = relations.filter((r) => r.ownerTable === ownerTable);
    if (tableRels.length === 0) return record;

    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(record)) {
      result[k] = v;
    }

    // ── Scalar relations (lazy) ───────────────────────────────────────────────
    const scalarRels = tableRels.filter((r) => r.kind === "scalar");
    if (scalarRels.length > 0) {
      const related = new Proxy(
        {} as Record<string, unknown>,
        {
          get(_target, prop: string) {
            const rel = scalarRels.find(
              (r) => r.as === prop || r.ownerField === prop
            );
            if (!rel) return undefined;
            const targetRepo = repos.get(rel.targetTable);
            if (!targetRepo) return null;
            const fkVal = record[rel.ownerField];
            if (fkVal == null) return null;
            const found = targetRepo.raw(
              `SELECT * FROM "${rel.targetTable}" WHERE "${rel.targetField}" = ? LIMIT 1`,
              fkVal
            )[0];
            return found ?? null;
          },
        }
      );
      Object.defineProperty(result, "related", {
        value: related,
        writable: false,
        enumerable: false,
        configurable: false,
      });

      for (const rel of scalarRels) {
        if (rel.as) {
          Object.defineProperty(result, rel.as, {
            get() {
              return (result.related as Record<string, unknown>)[rel.as!];
            },
            enumerable: false,
            configurable: false,
          });
        }
      }
    }

    // ── Sub-table relations (batch per materialize call) ──────────────────────
    const subTableRels = tableRels.filter((r) => r.kind === "subTable");
    for (const rel of subTableRels) {
      const [subField, fkField] = rel.ownerField.split(".") as [string, string];
      const items = result[subField];
      if (!globalThis.Array.isArray(items)) continue;

      const targetRepo = repos.get(rel.targetTable);
      if (!targetRepo) continue;

      const fkValues = items
        .map((item: unknown) => (item as Record<string, unknown>)[fkField])
        .filter((v) => v != null);

      let byKey = new Map<unknown, Record<string, unknown>>();
      if (fkValues.length > 0) {
        const ph = fkValues.map(() => "?").join(", ");
        const fetched = targetRepo.raw<Record<string, unknown>>(
          `SELECT * FROM "${rel.targetTable}" WHERE "${rel.targetField}" IN (${ph})`,
          ...fkValues
        );
        byKey = new Map(fetched.map((r) => [r[rel.targetField], r]));
      }

      result[subField] = items.map((item: unknown) => {
        const resolved =
          byKey.get((item as Record<string, unknown>)[fkField]) ?? null;
        const wrapper = Object.create(null);
        Object.assign(wrapper, item);

        const itemRelated = new Proxy(
          {} as Record<string, unknown>,
          {
            get(_target, prop: string) {
              if (prop === rel.as || prop === rel.ownerField) {
                return resolved;
              }
              return undefined;
            },
          }
        );
        Object.defineProperty(wrapper, "related", {
          value: itemRelated,
          writable: false,
          enumerable: false,
          configurable: false,
        });

        if (rel.as) {
          Object.defineProperty(wrapper, rel.as, {
            value: resolved,
            writable: false,
            enumerable: false,
            configurable: false,
          });
        }

        return wrapper;
      });
    }

    return result;
  }

  function materializeMany(
    ownerTable: string,
    records: Record<string, unknown>[]
  ): Array<Record<string, unknown>> {
    if (records.length === 0) return [];

    const tableRels = relations.filter((r) => r.ownerTable === ownerTable);
    if (tableRels.length === 0) return records;

    const results = records.map((r) => {
      const proto = Object.getPrototypeOf(r);
      const copy = proto
        ? Object.create(proto)
        : ({} as Record<string, unknown>);
      Object.assign(copy, r);
      return copy;
    });

    const scalarRels = tableRels.filter((r) => r.kind === "scalar");
    const subTableRels = tableRels.filter((r) => r.kind === "subTable");

    for (const rel of scalarRels) {
      const targetRepo = repos.get(rel.targetTable);
      if (!targetRepo) continue;
      const col = rel.ownerField;
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
        const val = byKey.get(rec[col]);
        if (val) {
          Object.defineProperty(rec, `_${col}_resolved`, {
            value: val,
            writable: false,
            enumerable: false,
            configurable: false,
          });
        }
      }
    }

    for (const rel of subTableRels) {
      const targetRepo = repos.get(rel.targetTable);
      if (!targetRepo) continue;
      const [subField, fkField] = rel.ownerField.split(".") as [string, string];
      const allFkValues = [
        ...new Set(
          results.flatMap((r) => {
            const items = r[subField];
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
        const items = rec[subField];
        if (!globalThis.Array.isArray(items)) continue;
        rec[subField] = items.map((item) => {
          const resolved =
            byKey.get((item as Record<string, unknown>)[fkField]) ?? null;
          const wrapper = Object.create(null);
          Object.assign(wrapper, item);

          const itemRelated = new Proxy(
            {} as Record<string, unknown>,
            {
              get(_target, prop: string) {
                if (prop === rel.as || prop === rel.ownerField) {
                  return resolved;
                }
                return undefined;
              },
            }
          );
          Object.defineProperty(wrapper, "related", {
            value: itemRelated,
            writable: false,
            enumerable: false,
            configurable: false,
          });

          if (rel.as) {
            Object.defineProperty(wrapper, rel.as, {
              value: resolved,
              writable: false,
              enumerable: false,
              configurable: false,
            });
          }

          return wrapper;
        });
      }
    }

    // Attach parent .related for scalar relations (pre-resolved)
    if (scalarRels.length > 0) {
      for (const rec of results) {
        const related = new Proxy(
          {} as Record<string, unknown>,
          {
            get(_target, prop: string) {
              const rel = scalarRels.find(
                (r) => r.as === prop || r.ownerField === prop
              );
              if (!rel) return undefined;
              return (
                (rec as Record<string, unknown>)[
                  `_${rel.ownerField}_resolved`
                ] ?? null
              );
            },
          }
        );
        Object.defineProperty(rec, "related", {
          value: related,
          writable: false,
          enumerable: false,
          configurable: false,
        });

        for (const rel of scalarRels) {
          if (rel.as) {
            Object.defineProperty(rec, rel.as, {
              get() {
                return (
                  (rec as Record<string, unknown>)[
                    `_${rel.ownerField}_resolved`
                  ] ?? null
                );
              },
              enumerable: false,
              configurable: false,
            });
          }
        }
      }
    }

    return results;
  }

  // ─── Metadata helpers ───────────────────────────────────────────────────────

  function flush(opts?: { includeMeta?: boolean }): void {
    for (const repo of repos.values()) {
      repo.flush();
    }
    if (opts?.includeMeta) {
      for (const key of ["_schema_hash", "_schema_compressed", "_tables", "_relations", "_bunorm_version"]) {
        meta.delete(key);
      }
    }
  }

  // ─── Typed meta accessors ───────────────────────────────────────────────────

  const metaAccessors: MetaAccessors = {
    get schemaHash() {
      return meta.getString("_schema_hash");
    },
    get schemaJSON() {
      const compressed = meta.getCompressed("_schema_compressed");
      return compressed ? new TextDecoder().decode(compressed) : null;
    },
    get tables() {
      return meta.getJSON<string[]>("_tables");
    },
    get relations() {
      return meta.getJSON<unknown[]>("_relations");
    },
    get version() {
      return meta.getString("_bunorm_version");
    },
  };

  // ─── Inject materializers into repositories ─────────────────────────────────

  for (const [name, repo] of repos) {
    const tableRels = relations.filter((r) => r.ownerTable === name);
    if (tableRels.length === 0) continue;

    repo.setMaterializer(
      (record) => materialize(name, record),
      (records) => materializeMany(name, records)
    );
  }

  // ─── Build accessor object with getters ─────────────────────────────────────

  const accessors = {} as BunORM<T, Rels>;

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
    meta: metaAccessors,
    materialize,
    materializeMany,
    flush,
  });

  return accessors;
}
