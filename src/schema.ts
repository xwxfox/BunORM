/**
 * foxdb/src/schema.ts
 * Runtime schema introspection - walks TObject properties and produces
 * the SQL column/table DDL as well as the flatten/hydrate mappings.
 * Uses typebox 1.x guard functions (IsObject, IsArray, etc.)
 */

import {
  IsObject,
  IsArray,
  IsString,
  IsNumber,
  IsInteger,
  IsBoolean,
  IsLiteral,
  IsOptional,
  type TObject,
  type TSchema,
  type TProperties,
  type TLiteral,
} from "typebox";
import type { ColumnCodec } from "./codec.ts";

// ─── Column metadata ──────────────────────────────────────────────────────────

/** @category Advanced */
export type SqliteType = "TEXT" | "INTEGER" | "REAL" | "BLOB";

/** @category Advanced */
export interface ColumnMeta {
  name: string;
  sqlType: SqliteType;
  nullable: boolean;
  /** True if this is actually an `Optional` wrapper */
  optional: boolean;
  /** Path segments for flattened nested columns, e.g. ["Status", "Group"] */
  path?: string[];
  /** True if the underlying schema is a boolean (stored as INTEGER) */
  isBoolean?: boolean;
  /** True if this is a generated column */
  generated?: boolean;
  /** Expression for generated columns */
  generatedExpr?: string;
}

/** @category Advanced */
export interface SubTableMeta {
  /** e.g. "lineItems" */
  fieldName: string;
  /** e.g. "sales__lineItems" */
  tableName: string;
  /** Schema of a single item in the array */
  itemSchema: TSchema & { properties: Record<string, TSchema> };
  /** Columns of the sub-table row (owner PK is prepended automatically) */
  columns: ColumnMeta[];
  columnByName: Map<string, ColumnMeta>;
  columnByPath: Map<string, ColumnMeta>;
}

/** @category Advanced */
export interface TableMeta {
  tableName: string;
  columns: ColumnMeta[];
  subTables: SubTableMeta[];
  /** Map from dotted path → ColumnMeta for O(1) resolution */
  columnByPath: Map<string, ColumnMeta>;
  /** Map from column name → ColumnMeta for O(1) resolution */
  columnByName: Map<string, ColumnMeta>;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function unwrapOptional(schema: TSchema): { schema: TSchema; optional: boolean } {
  if (IsOptional(schema)) {
    return { schema, optional: true };
  }
  return { schema, optional: false };
}

function schemaAnyOfMembers(schema: TSchema): TSchema[] | null {
  const obj = schema as Record<string, unknown>;
  if (obj.anyOf && Array.isArray(obj.anyOf)) {
    return (obj.anyOf as TSchema[]);
  }
  return null;
}

function schemaConstValue(schema: TSchema): unknown {
  const obj = schema as Record<string, unknown>;
  return obj.const;
}

function schemaProperties(schema: TSchema): Record<string, TSchema> | null {
  const obj = schema as Record<string, unknown>;
  if (obj.properties && typeof obj.properties === "object" && obj.properties !== null) {
    return obj.properties as Record<string, TSchema>;
  }
  return null;
}

function schemaItems(schema: TSchema): TSchema | null {
  const obj = schema as Record<string, unknown>;
  if (obj.items && typeof obj.items === "object" && obj.items !== null) {
    return obj.items as TSchema;
  }
  return null;
}

/**
 * Detect schemas like `Type.Union([Type.String(), Type.Null()])` which are
 * nullable without being wrapped in `Type.Optional()`.
 */
function isNullableUnion(schema: TSchema): boolean {
  const members = schemaAnyOfMembers(schema);
  if (members) {
    return members.some((item) => {
      const obj = item as Record<string, unknown>;
      return obj.type === "null";
    });
  }
  return false;
}

function schemaToSqlType(schema: TSchema): SqliteType {
  if (IsInteger(schema)) return "INTEGER";
  if (IsNumber(schema)) return "REAL";
  if (IsBoolean(schema)) return "INTEGER";
  if (IsString(schema)) return "TEXT";
  if (IsLiteral(schema)) {
    const v = schemaConstValue(schema);
    if (typeof v === "number") return Number.isInteger(v) ? "INTEGER" : "REAL";
    if (typeof v === "boolean") return "INTEGER";
    return "TEXT";
  }
  if (isNullableUnion(schema)) {
    const members = schemaAnyOfMembers(schema);
    if (members) {
      const nonNull = members.find((m) => {
        const obj = m as Record<string, unknown>;
        return obj.type !== "null";
      });
      if (nonNull) return schemaToSqlType(nonNull);
    }
  }
  return "TEXT";
}

function isScalarLike(schema: TSchema): boolean {
  if (IsString(schema) || IsNumber(schema) || IsInteger(schema) || IsBoolean(schema) || IsLiteral(schema))
    return true;
  if (isNullableUnion(schema)) {
    const members = schemaAnyOfMembers(schema);
    if (members) {
      const nonNull = members.find((m) => {
        const obj = m as Record<string, unknown>;
        return obj.type !== "null";
      });
      if (!nonNull) return false;
      return isScalarLike(nonNull);
    }
  }
  return false;
}

function shouldFlattenObject(schema: TSchema): boolean {
  if (!IsObject(schema)) return false;
  const props = schemaProperties(schema);
  if (!props) return false;
  for (const raw of Object.values(props)) {
    if (IsArray(raw) || IsObject(raw)) continue;
    const { schema: inner } = unwrapOptional(raw);
    if (IsArray(inner) || IsObject(inner)) continue;
    if (isScalarLike(inner)) continue;
    return false;
  }
  return true;
}

export function buildColumns(
  properties: TProperties,
  prefix: string[] = [],
  depth = 0,
  skipObjectArrays = false
): ColumnMeta[] {
  const cols: ColumnMeta[] = [];
  for (const [name, raw] of Object.entries(properties)) {
    if (IsArray(raw)) {
      const { optional } = unwrapOptional(raw);
      // Arrays of objects → sub-table ONLY when explicitly told to skip
      if (skipObjectArrays && depth === 0 && IsObject(raw.items)) continue;
      // Everywhere else (inside flattened objects, or sub-tables) → JSON TEXT
      const colName = prefix.length > 0 ? [...prefix, name].join("__") : name;
      cols.push({
        name: colName,
        sqlType: "TEXT",
        nullable: optional,
        optional,
        path: prefix.length > 0 ? [...prefix, name] : undefined,
      });
      continue;
    }
    if (IsObject(raw) && depth < 2 && shouldFlattenObject(raw)) {
      cols.push(...buildColumns(raw.properties, [...prefix, name], depth + 1, skipObjectArrays));
      continue;
    }
    const { schema, optional } = unwrapOptional(raw);
    const nullable = optional || isNullableUnion(schema);
    const colName = prefix.length > 0 ? [...prefix, name].join("__") : name;
    cols.push({
      name: colName,
      sqlType: IsObject(schema) ? "TEXT" : schemaToSqlType(schema),
      nullable,
      optional: nullable,
      path: prefix.length > 0 ? [...prefix, name] : undefined,
      isBoolean: IsBoolean(schema),
    });
  }
  return cols;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/** @category Advanced */
export function introspectTable(
  tableName: string,
  schema: TSchema & { properties: Record<string, TSchema> },
  generated?: Array<{ name: string; expr: string; sqlType?: SqliteType }>
): TableMeta {
  const subTables: SubTableMeta[] = [];

  for (const [fieldName, raw] of Object.entries(schema.properties)) {
    if (IsArray(raw) && IsObject(raw.items)) {
      const itemSchema = raw.items;
      const subTableName = `${tableName}__${fieldName}`;
      const subCols = buildColumns(itemSchema.properties, [], 0, false);
      const subByName = new Map<string, ColumnMeta>();
      const subByPath = new Map<string, ColumnMeta>();
      for (const col of subCols) {
        subByName.set(col.name, col);
        if (col.path) subByPath.set(col.path.join("."), col);
      }
      subTables.push({
        fieldName,
        tableName: subTableName,
        itemSchema,
        columns: subCols,
        columnByName: subByName,
        columnByPath: subByPath,
      });
    }
  }

  const columns = buildColumns(schema.properties, [], 0, true);

  if (generated) {
    for (const g of generated) {
      columns.push({
        name: g.name,
        sqlType: g.sqlType ?? "TEXT",
        nullable: true,
        optional: true,
        generated: true,
        generatedExpr: g.expr,
      });
    }
  }

  const columnByPath = new Map<string, ColumnMeta>();
  const columnByName = new Map<string, ColumnMeta>();
  for (const col of columns) {
    columnByName.set(col.name, col);
    if (col.path) columnByPath.set(col.path.join("."), col);
  }
  return { tableName, columns, subTables, columnByPath, columnByName };
}

// ─── DDL generation ───────────────────────────────────────────────────────────

/** @category Advanced */
export function buildCreateTableSQL(
  meta: TableMeta,
  primaryKey: string
): string[] {
  const stmts: string[] = [];

  // Main table
  const colDefs = meta.columns.map((c) => {
    const notNull = !c.nullable ? " NOT NULL" : "";
    const pk = c.name === primaryKey ? " PRIMARY KEY" : "";
    const generated = c.generated && c.generatedExpr ? ` GENERATED ALWAYS AS (${c.generatedExpr}) STORED` : "";
    return `  "${c.name}" ${c.sqlType}${pk}${notNull}${generated}`;
  });
  stmts.push(
    `CREATE TABLE IF NOT EXISTS "${meta.tableName}" (\n${colDefs.join(",\n")}\n)`
  );

  // Sub-tables - each gets an auto _rowid_ and a FK back to owner
  for (const sub of meta.subTables) {
    const subCols = [
      `  "_id" INTEGER PRIMARY KEY AUTOINCREMENT`,
      `  "_owner_id" ${meta.columns.find((c) => c.name === primaryKey)?.sqlType ?? "TEXT"} NOT NULL`,
      `  "_index" INTEGER NOT NULL`,
      ...sub.columns.map((c) => {
        const notNull = !c.nullable ? " NOT NULL" : "";
        return `  "${c.name}" ${c.sqlType}${notNull}`;
      }),
    ];
    stmts.push(
      `CREATE TABLE IF NOT EXISTS "${sub.tableName}" (\n${subCols.join(",\n")}\n)`
    );
    // Index on owner FK for fast hydration
    stmts.push(
      `CREATE INDEX IF NOT EXISTS "idx_${sub.tableName}__owner" ON "${sub.tableName}" ("_owner_id")`
    );
  }

  return stmts;
}

export function buildIndexSQL(
  tableName: string,
  columns: string[],
  unique: boolean,
  name?: string,
  where?: string,
  include?: string[]
): string {
  const idxName = name ?? `idx_${tableName}__${columns.join("_")}`;
  const uniq = unique ? "UNIQUE " : "";
  const cols = columns.map((c) => `"${c}"`).join(", ");
  // SQLite in this environment does not support the INCLUDE clause;
  // silently drop included columns so the API remains portable.
  const wh = where ? ` WHERE ${where}` : "";
  return `CREATE ${uniq}INDEX IF NOT EXISTS "${idxName}" ON "${tableName}" (${cols})${wh}`;
}

// ─── Flatten / hydrate ────────────────────────────────────────────────────────

/**
 * Flatten a full user object into the main-table row object.
 * Arrays are stripped; nested objects are JSON-stringified.
 */
function encodeValue(v: unknown, sqlType: SqliteType): unknown {
  if (v === undefined || v === null) return null;
  if (sqlType === "TEXT" && typeof v === "object") return JSON.stringify(v);
  if (sqlType === "INTEGER" && typeof v === "boolean") return v ? 1 : 0;
  return toSqliteScalar(v);
}

function encodeValueWithCodec(v: unknown, sqlType: SqliteType, codec: ColumnCodec | undefined): unknown {
  const encoded = encodeValue(v, sqlType);
  if (!codec) return encoded;
  return codec.encode(encoded);
}

function getValueAtPath(obj: unknown, path: string[]): unknown {
  let current: unknown = obj;
  for (const key of path) {
    if (current === null || current === undefined) return undefined;
    if (typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function setValueAtPath(obj: Record<string, unknown>, path: string[], value: unknown): void {
  let current: Record<string, unknown> = obj;
  for (let i = 0; i < path.length - 1; i++) {
    const key = path[i]!;
    if (!(key in current)) current[key] = {};
    current = current[key] as Record<string, unknown>;
  }
  current[path[path.length - 1]!] = value;
}

export function flattenRow(
  obj: Record<string, unknown>,
  meta: TableMeta,
  codecs?: Map<string, ColumnCodec>
): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  if (!codecs?.size) {
    for (const col of meta.columns) {
      if (col.generated) continue;
      const v = col.path ? getValueAtPath(obj, col.path) : obj[col.name];
      row[col.name] = encodeValue(v, col.sqlType);
    }
  } else {
    for (const col of meta.columns) {
      if (col.generated) continue;
      const v = col.path ? getValueAtPath(obj, col.path) : obj[col.name];
      let encoded = encodeValue(v, col.sqlType);
      const codec = codecs.get(col.name);
      if (codec) encoded = codec.encode(encoded);
      row[col.name] = encoded;
    }
  }
  return row;
}

/**
 * Flatten only the columns present in a partial patch object.
 * Missing columns are omitted so they are not overwritten in UPDATE ... SET.
 */
export function flattenPatch(
  obj: Record<string, unknown>,
  meta: TableMeta,
  codecs?: Map<string, ColumnCodec>
): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  for (const col of meta.columns) {
    if (col.generated) continue;
    if (!(col.name in obj) && !col.path) continue;
    let v: unknown;
    if (col.path) {
      v = getValueAtPath(obj, col.path);
    } else {
      v = obj[col.name];
    }
    if (v === undefined) continue;
    let encoded = encodeValue(v, col.sqlType);
    const codec = codecs?.get(col.name);
    if (codec) encoded = codec.encode(encoded);
    row[col.name] = encoded;
  }
  return row;
}

/**
 * Flatten sub-table items for a given field, attaching owner PK.
 */
export function flattenSubRows(
  ownerPk: SqliteScalar,
  items: unknown[],
  sub: SubTableMeta,
  codecs?: Map<string, ColumnCodec>
): Array<Record<string, unknown>> {
  const result: Array<Record<string, unknown>> = new Array(items.length);
  if (!codecs?.size) {
    for (let idx = 0; idx < items.length; idx++) {
      const item = items[idx];
      if (item === null || typeof item !== "object") {
        throw new TypeError("Sub-table item must be an object");
      }
      const obj = item as Record<string, unknown>;
      const row: Record<string, unknown> = {
        _owner_id: ownerPk,
        _index: idx,
      };
      for (const col of sub.columns) {
        const v = col.path ? getValueAtPath(obj, col.path) : obj[col.name];
        row[col.name] = encodeValue(v, col.sqlType);
      }
      result[idx] = row;
    }
  } else {
    for (let idx = 0; idx < items.length; idx++) {
      const item = items[idx];
      if (item === null || typeof item !== "object") {
        throw new TypeError("Sub-table item must be an object");
      }
      const obj = item as Record<string, unknown>;
      const row: Record<string, unknown> = {
        _owner_id: ownerPk,
        _index: idx,
      };
      for (const col of sub.columns) {
        const v = col.path ? getValueAtPath(obj, col.path) : obj[col.name];
        let encoded = encodeValue(v, col.sqlType);
        const codec = codecs.get(col.name);
        if (codec) encoded = codec.encode(encoded);
        row[col.name] = encoded;
      }
      result[idx] = row;
    }
  }
  return result;
}

export type SqliteScalar = string | number | boolean | null | bigint;

function toSqliteScalar(v: unknown): SqliteScalar {
  if (v === null || v === undefined) return null;
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean" || typeof v === "bigint") return v;
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

/**
 * Rehydrate a flat DB row back into the full object shape.
 * Sub-table arrays must be provided separately and are spliced in.
 */
function decodeValue(
  v: unknown,
  sqlType: SqliteType,
  isBoolean?: boolean
): unknown {
  if (sqlType === "TEXT" && typeof v === "string") {
    const first = v.charCodeAt(0);
    // Only attempt JSON.parse for objects/arrays (starts with { or [)
    if (first === 123 || first === 91) {
      try {
        const parsed = JSON.parse(v);
        return typeof parsed === "object" ? parsed : v;
      } catch {
        return v;
      }
    }
    return v;
  }
  if (sqlType === "INTEGER" && typeof v === "number") {
    return isBoolean ? v === 1 : v;
  }
  return v ?? null;
}

/** Fast path: hydrate with no select filtering, no codecs, no subTables */
function hydrateRowFast(
  flat: Record<string, unknown>,
  meta: TableMeta
): Record<string, unknown> {
  const obj: Record<string, unknown> = {};
  for (const col of meta.columns) {
    const v = decodeValue(flat[col.name], col.sqlType, col.isBoolean);
    if (col.path) {
      if (col.path.length === 1) {
        obj[col.path[0]!] = v;
      } else {
        setValueAtPath(obj, col.path, v);
      }
    } else {
      obj[col.name] = v;
    }
  }
  return obj;
}

export function hydrateRow(
  flat: Record<string, unknown>,
  meta: TableMeta,
  subRows: Map<string, Record<string, unknown>[]>,
  codecs?: Map<string, ColumnCodec>,
  select?: string[],
  include?: string[]
): Record<string, unknown> {
  // Fast path: no codecs, no select, no subTables
  if (!codecs?.size && !select && !meta.subTables.length) {
    return hydrateRowFast(flat, meta);
  }

  const obj: Record<string, unknown> = {};

  if (!select) {
    // No select filtering — iterate all columns
    if (!codecs?.size) {
      for (const col of meta.columns) {
        const v = decodeValue(flat[col.name], col.sqlType, col.isBoolean);
        if (col.path) {
          if (col.path.length === 1) {
            obj[col.path[0]!] = v;
          } else {
            setValueAtPath(obj, col.path, v);
          }
        } else {
          obj[col.name] = v;
        }
      }
    } else {
      for (const col of meta.columns) {
        let v = flat[col.name];
        const codec = codecs.get(col.name);
        if (codec) v = codec.decode(v);
        const decoded = decodeValue(v, col.sqlType, col.isBoolean);
        if (col.path) {
          if (col.path.length === 1) {
            obj[col.path[0]!] = decoded;
          } else {
            setValueAtPath(obj, col.path, decoded);
          }
        } else {
          obj[col.name] = decoded;
        }
      }
    }
  } else {
    // select filtering — build a set of selected columns
    const selectedSet = new Set<string>();
    for (const s of select) {
      selectedSet.add(s);
      if (!s.includes(".")) {
        for (const col of meta.columns) {
          if (col.path && col.path[0] === s) selectedSet.add(col.name);
        }
      } else {
        const col = meta.columnByPath.get(s);
        if (col) selectedSet.add(col.name);
      }
    }

    for (const col of meta.columns) {
      if (!selectedSet.has(col.name)) continue;
      let v = flat[col.name];
      const codec = codecs?.get(col.name);
      if (codec) v = codec.decode(v);
      const decoded = decodeValue(v, col.sqlType, col.isBoolean);
      if (col.path) {
        if (col.path.length === 1) {
          obj[col.path[0]!] = decoded;
        } else {
          setValueAtPath(obj, col.path, decoded);
        }
      } else {
        obj[col.name] = decoded;
      }
    }

    // Handle synthetic aliases from JSON_EXTRACT on depth-2+ selects
    for (const key of Object.keys(flat)) {
      if (selectedSet.has(key)) continue;
      if (key.includes("__")) {
        const parts = key.split("__");
        let decoded = flat[key];
        if (typeof decoded === "string") {
          const first = decoded.charCodeAt(0);
          if (first === 123 || first === 91) {
            try {
              const parsed = JSON.parse(decoded);
              if (typeof parsed === "object") decoded = parsed;
            } catch { /* leave as string */ }
          }
        }
        setValueAtPath(obj, parts, decoded);
      }
    }
  }

  for (const sub of meta.subTables) {
    if (include && !include.includes(sub.fieldName)) {
      obj[sub.fieldName] = [];
    } else {
      obj[sub.fieldName] = subRows.get(sub.tableName) ?? [];
    }
  }

  return obj;
}
