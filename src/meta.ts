/**
 * bunorm/src/meta.ts
 * TypeBox-backed metadata store for BunORM.
 *
 * Zero tolerance for type casts (`as`), `unknown`, or untyped strings.
 * Every DB row is validated at runtime with Schema.Compile.
 */

import { Type, type Static, type TSchema } from "typebox";
import Schema, { type Validator } from "typebox/schema";
import { BunDatabase } from "./database.ts";

// ─── Row schema ───────────────────────────────────────────────────────────────

const MetaRecordSchema = Type.Object({
  key: Type.String(),
  value: Type.String(),
  encoding: Type.String(),
  updatedAt: Type.Integer(),
});

const MetaCompiled = Schema.Compile(MetaRecordSchema);

type MetaRecord = Static<typeof MetaRecordSchema>;

// ─── Typed-accessor schemas ───────────────────────────────────────────────────

const SchemaHashSchema = Type.String();

const SchemaJSONSchema = Type.Record(
  Type.String(),
  Type.Object({
    primaryKey: Type.String(),
    columns: Type.Array(Type.String()),
  })
);

const TablesSchema = Type.Array(Type.String());

const RelationsSchema = Type.Array(
  Type.Object({
    ownerTable: Type.String(),
    ownerField: Type.String(),
    targetTable: Type.String(),
    targetField: Type.String(),
    kind: Type.Union([Type.Literal("scalar"), Type.Literal("subTable")]),
    as: Type.Optional(Type.String()),
  })
);

const VersionSchema = Type.String();

// Compiled validators for typed accessors
const SchemaHashCompiled = Schema.Compile(SchemaHashSchema);
const SchemaJSONCompiled = Schema.Compile(SchemaJSONSchema);
const TablesCompiled = Schema.Compile(TablesSchema);
const RelationsCompiled = Schema.Compile(RelationsSchema);
const VersionCompiled = Schema.Compile(VersionSchema);

type SchemaHash = Static<typeof SchemaHashSchema>;
type SchemaJSON = Static<typeof SchemaJSONSchema>;
type TablesList = Static<typeof TablesSchema>;
type RelationsList = Static<typeof RelationsSchema>;
type Version = Static<typeof VersionSchema>;

// ─── Encoding constants ───────────────────────────────────────────────────────

const ENCODING_PLAIN = "plain";
const ENCODING_JSON = "json";
const ENCODING_DEFLATE_BASE64 = "deflate-base64";

// ─── MetaStore ────────────────────────────────────────────────────────────────

export class MetaStore {
  private readonly db: BunDatabase;

  private static readonly KEY_SCHEMA_HASH = "schemaHash";
  private static readonly KEY_SCHEMA_JSON = "schemaJSON";
  private static readonly KEY_TABLES = "tables";
  private static readonly KEY_RELATIONS = "relations";
  private static readonly KEY_VERSION = "version";

  constructor(db: BunDatabase) {
    this.db = db;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS _bunorm_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        encoding TEXT NOT NULL,
        updatedAt INTEGER NOT NULL
      )
    `);
  }

  // ─── Core helpers ───────────────────────────────────────────────────────────

  private getRow(key: string): MetaRecord | null {
    const stmt = this.db.prepare(
      "SELECT key, value, encoding, updatedAt FROM _bunorm_meta WHERE key = ?"
    );
    const raw = stmt.get(key);
    if (raw == null) return null;

    try {
      return MetaCompiled.Parse(raw);
    } catch {
      const [, errors] = MetaCompiled.Errors(raw);
      throw new Error(
        `MetaStore: row validation failed for key "${key}". Errors: ${JSON.stringify(errors)}`
      );
    }
  }

  private setRow(key: string, value: string, encoding: string): void {
    const stmt = this.db.prepare(`
      INSERT INTO _bunorm_meta (key, value, encoding, updatedAt)
      VALUES (?, ?, ?, ?)
      ON CONFLICT (key) DO UPDATE SET
        value = excluded.value,
        encoding = excluded.encoding,
        updatedAt = excluded.updatedAt
    `);
    stmt.run(key, value, encoding, Date.now());
  }

  private getValidatedJSON<T extends TSchema>(
    key: string,
    validator: Validator<T, Static<T>>
  ): Static<T> | null {
    const row = this.getRow(key);
    if (row == null) return null;
    const parsed = JSON.parse(row.value);
    try {
      return validator.Parse(parsed);
    } catch {
      const [, errors] = validator.Errors(parsed);
      throw new Error(
        `MetaStore: JSON validation failed for key "${key}". Errors: ${JSON.stringify(errors)}`
      );
    }
  }

  private setValidatedJSON<T extends TSchema>(
    key: string,
    validator: Validator<T, Static<T>>,
    value: Static<T>
  ): void {
    try {
      validator.Parse(value);
    } catch {
      const [, errors] = validator.Errors(value);
      throw new Error(
        `MetaStore: JSON validation failed for key "${key}" before write. Errors: ${JSON.stringify(errors)}`
      );
    }
    this.setRow(key, JSON.stringify(value), ENCODING_JSON);
  }

  // ─── String accessors ───────────────────────────────────────────────────────

  getString(key: string): string | null {
    const row = this.getRow(key);
    if (row == null) return null;
    return row.value;
  }

  setString(key: string, value: string): void {
    this.setRow(key, value, ENCODING_PLAIN);
  }

  // ─── JSON accessors ─────────────────────────────────────────────────────────

  getJSON<T>(key: string): T | null {
    const row = this.getRow(key);
    if (row == null) return null;
    return JSON.parse(row.value);
  }

  setJSON(key: string, value: unknown): void {
    this.setRow(key, JSON.stringify(value), ENCODING_JSON);
  }

  // ─── Compressed accessors ───────────────────────────────────────────────────

  getCompressed(key: string): Uint8Array | null {
    const row = this.getRow(key);
    if (row == null) return null;
    if (row.encoding !== ENCODING_DEFLATE_BASE64) return null;
    const decoded = Uint8Array.fromBase64(row.value);
    return Bun.inflateSync(decoded);
  }

  setCompressed(key: string, data: Uint8Array): void {
    const copy = new Uint8Array(data);
    const deflated = Bun.deflateSync(copy);
    const encoded = deflated.toBase64();
    this.setRow(key, encoded, ENCODING_DEFLATE_BASE64);
  }

  // ─── Delete ─────────────────────────────────────────────────────────────────

  delete(key: string): void {
    const stmt = this.db.prepare("DELETE FROM _bunorm_meta WHERE key = ?");
    stmt.run(key);
  }

  // ─── Typed accessors ────────────────────────────────────────────────────────

  getSchemaHash(): SchemaHash | null {
    return this.getString(MetaStore.KEY_SCHEMA_HASH);
  }

  setSchemaHash(value: SchemaHash): void {
    this.setString(MetaStore.KEY_SCHEMA_HASH, value);
  }

  getSchemaJSON(): SchemaJSON | null {
    return this.getValidatedJSON(MetaStore.KEY_SCHEMA_JSON, SchemaJSONCompiled);
  }

  setSchemaJSON(value: SchemaJSON): void {
    this.setValidatedJSON(MetaStore.KEY_SCHEMA_JSON, SchemaJSONCompiled, value);
  }

  getTables(): TablesList | null {
    return this.getValidatedJSON(MetaStore.KEY_TABLES, TablesCompiled);
  }

  setTables(value: TablesList): void {
    this.setValidatedJSON(MetaStore.KEY_TABLES, TablesCompiled, value);
  }

  getRelations(): RelationsList | null {
    return this.getValidatedJSON(MetaStore.KEY_RELATIONS, RelationsCompiled);
  }

  setRelations(value: RelationsList): void {
    this.setValidatedJSON(MetaStore.KEY_RELATIONS, RelationsCompiled, value);
  }

  getVersion(): Version | null {
    return this.getString(MetaStore.KEY_VERSION);
  }

  setVersion(value: Version): void {
    this.setString(MetaStore.KEY_VERSION, value);
  }
}
