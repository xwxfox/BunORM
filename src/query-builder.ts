/**
 * bunorm/src/query-builder.ts
 * Builds parameterized SQL from typed WhereClause / OrderBy / pagination.
 * Never does string interpolation of user values — always uses ? placeholders.
 */

import type { TObject } from "typebox";
import type {
  WhereClause,
  OrderByClause,
  FindOptions,
} from "./types.ts";

// ─── WHERE builder ────────────────────────────────────────────────────────────

type FilterEntry = { sql: string; params: unknown[] };

function buildFilter(column: string, filter: Record<string, unknown>): FilterEntry {
  if ("eq" in filter) return { sql: `"${column}" = ?`, params: [filter.eq] };
  if ("ne" in filter) return { sql: `"${column}" != ?`, params: [filter.ne] };
  if ("gt" in filter) return { sql: `"${column}" > ?`, params: [filter.gt] };
  if ("gte" in filter) return { sql: `"${column}" >= ?`, params: [filter.gte] };
  if ("lt" in filter) return { sql: `"${column}" < ?`, params: [filter.lt] };
  if ("lte" in filter) return { sql: `"${column}" <= ?`, params: [filter.lte] };
  if ("like" in filter) return { sql: `"${column}" LIKE ?`, params: [filter.like] };
  if ("between" in filter) {
    const [lo, hi] = filter.between as [unknown, unknown];
    return { sql: `"${column}" BETWEEN ? AND ?`, params: [lo, hi] };
  }
  if ("in" in filter) {
    const vals = filter.in as unknown[];
    const placeholders = vals.map(() => "?").join(", ");
    return { sql: `"${column}" IN (${placeholders})`, params: vals };
  }
  if ("notIn" in filter) {
    const vals = filter.notIn as unknown[];
    const placeholders = vals.map(() => "?").join(", ");
    return { sql: `"${column}" NOT IN (${placeholders})`, params: vals };
  }
  if ("isNull" in filter) return { sql: `"${column}" IS NULL`, params: [] };
  if ("isNotNull" in filter) return { sql: `"${column}" IS NOT NULL`, params: [] };
  throw new Error(`bunorm: unknown filter operator for column "${column}"`);
}

export interface WhereResult {
  sql: string;      // "WHERE ..." or ""
  params: unknown[];
}

export function buildWhere<T extends TObject>(
  where: WhereClause<T> | undefined
): WhereResult {
  if (!where || Object.keys(where).length === 0) return { sql: "", params: [] };

  const parts: string[] = [];
  const params: unknown[] = [];

  for (const [col, filter] of Object.entries(where)) {
    if (filter === undefined) continue;
    const entry = buildFilter(col, filter as Record<string, unknown>);
    parts.push(entry.sql);
    params.push(...entry.params);
  }

  if (parts.length === 0) return { sql: "", params: [] };
  return { sql: `WHERE ${parts.join(" AND ")}`, params };
}

// ─── ORDER BY builder ─────────────────────────────────────────────────────────

export function buildOrderBy<T extends TObject>(
  orderBy: FindOptions<T>["orderBy"]
): string {
  if (!orderBy) return "";
  const clauses = globalThis.Array.isArray(orderBy) ? orderBy : [orderBy];
  if (clauses.length === 0) return "";
  const parts = (clauses as OrderByClause<T>[]).map(
    (o) => `"${o.column}" ${o.direction ?? "ASC"}`
  );
  return `ORDER BY ${parts.join(", ")}`;
}

// ─── LIMIT / OFFSET ───────────────────────────────────────────────────────────

export function buildLimitOffset(
  limit?: number,
  offset?: number
): { sql: string; params: unknown[] } {
  const parts: string[] = [];
  const params: unknown[] = [];
  if (limit !== undefined) {
    parts.push("LIMIT ?");
    params.push(limit);
  }
  if (offset !== undefined) {
    parts.push("OFFSET ?");
    params.push(offset);
  }
  return { sql: parts.join(" "), params };
}

// ─── Full SELECT builder ──────────────────────────────────────────────────────

export interface SelectResult {
  sql: string;
  params: unknown[];
  countSql: string;
  countParams: unknown[];
}

export function buildSelect<T extends TObject>(
  tableName: string,
  opts: FindOptions<T>
): SelectResult {
  const { sql: whereSql, params: whereParams } = buildWhere(opts.where);
  const orderSql = buildOrderBy(opts.orderBy);
  const { sql: limitSql, params: limitParams } = buildLimitOffset(
    opts.limit,
    opts.offset
  );

  const clauses = [
    `SELECT * FROM "${tableName}"`,
    whereSql,
    orderSql,
    limitSql,
  ]
    .filter(Boolean)
    .join(" ");

  const countClauses = [
    `SELECT COUNT(*) as "_count" FROM "${tableName}"`,
    whereSql,
  ]
    .filter(Boolean)
    .join(" ");

  return {
    sql: clauses,
    params: [...whereParams, ...limitParams],
    countSql: countClauses,
    countParams: whereParams,
  };
}

// ─── INSERT builder ───────────────────────────────────────────────────────────

export function buildInsert(
  tableName: string,
  row: Record<string, unknown>
): { sql: string; params: unknown[] } {
  const keys = Object.keys(row);
  const cols = keys.map((k) => `"${k}"`).join(", ");
  const placeholders = keys.map(() => "?").join(", ");
  return {
    sql: `INSERT INTO "${tableName}" (${cols}) VALUES (${placeholders})`,
    params: keys.map((k) => row[k]),
  };
}

// ─── UPSERT (INSERT OR REPLACE / ON CONFLICT DO UPDATE) ──────────────────────

export function buildUpsert(
  tableName: string,
  row: Record<string, unknown>,
  conflictCols: string[],
  updateCols: string[]
): { sql: string; params: unknown[] } {
  const keys = Object.keys(row);
  const cols = keys.map((k) => `"${k}"`).join(", ");
  const placeholders = keys.map(() => "?").join(", ");
  const conflict = conflictCols.map((c) => `"${c}"`).join(", ");
  const updates = updateCols
    .map((c) => `"${c}" = excluded."${c}"`)
    .join(", ");

  return {
    sql: `INSERT INTO "${tableName}" (${cols}) VALUES (${placeholders}) ON CONFLICT (${conflict}) DO UPDATE SET ${updates}`,
    params: keys.map((k) => row[k]),
  };
}

// ─── UPDATE builder ───────────────────────────────────────────────────────────

export function buildUpdate<T extends TObject>(
  tableName: string,
  pk: string,
  pkValue: unknown,
  patch: Record<string, unknown>
): { sql: string; params: unknown[] } {
  const entries = Object.entries(patch).filter(([k]) => k !== pk);
  if (entries.length === 0) throw new Error("bunorm: no columns to update");
  const sets = entries.map(([k]) => `"${k}" = ?`).join(", ");
  return {
    sql: `UPDATE "${tableName}" SET ${sets} WHERE "${pk}" = ?`,
    params: [...entries.map(([, v]) => v), pkValue],
  };
}

// ─── DELETE builder ───────────────────────────────────────────────────────────

export function buildDelete<T extends TObject>(
  tableName: string,
  where: WhereClause<T>
): { sql: string; params: unknown[] } {
  const { sql: whereSql, params } = buildWhere(where);
  return {
    sql: `DELETE FROM "${tableName}" ${whereSql}`.trim(),
    params,
  };
}
