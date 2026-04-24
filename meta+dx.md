# Part 1: Flush + Metadata + DX — Implementation Plan

> **Status:** Approved  
> **Goal:** Add table flushing, metadata persistence, automatic timestamps, and general DX improvements.

---

## Architecture Decisions

| Decision | Choice |
|----------|--------|
| **Meta storage** | TypeBox-backed `_bunorm_meta` table with `key`, `value`, `encoding`, `updatedAt` columns |
| **Meta validation** | `Schema.Compile(MetaRecordSchema)` once, reused for all reads |
| **Schema compression** | `Bun.deflateSync` → base64 in `value` field, `encoding: "deflate-base64"` |
| **Timestamps** | Default `"createdAt"` / `"updatedAt"`. Override via `timestamps: { createdAt: "...", updatedAt: "..." }` |
| **Timestamps conflict** | If user schema already has the field name, skip injection (silent merge — no error) |
| **Flush** | `DELETE FROM` all rows. `drop()` is separate `DROP TABLE` |
| **Schema hash** | `Bun.hash(jsonString)` for fast comparison |
| **User schema storage** | Full serialized TypeBox schema JSON, compressed, stored in `_bunorm_meta._schema_compressed` |

---

## Why TypeBox-Backed Meta?

Instead of ad-hoc string keys, the `_bunorm_meta` table has a formal schema:

```ts
const MetaRecordSchema = Object({
  key: String(),
  value: String(),      // Base64-encoded compressed data, or raw JSON
  encoding: String(),   // "json" | "deflate-base64"
  updatedAt: Integer(),
});
```

**Benefits:**
- Every row read is validated via `Schema.Compile(MetaRecordSchema).Parse(row)`
- Corruption is caught immediately with a clear error
- Extensible: new accessors follow the same typed pattern
- Self-documenting: the schema lives in code, not implied by usage

---

## Files to Create

### `src/meta.ts` — Metadata Store

Responsibilities:
- Create `_bunorm_meta` table on init
- Validate every read with compiled `MetaRecordSchema`
- Provide generic accessors (`getString`, `setJSON`, `getCompressed`, etc.)
- Provide typed accessors for built-in keys (`getSchemaHash`, `setSchemaJSON`, `getTables`, etc.)

Key implementation detail:
```ts
const MetaCompiled = Schema.Compile(MetaRecordSchema);

private validate(row: unknown): MetaRecord {
  const result = MetaCompiled.Parse(row);
  if (result === undefined) {
    throw new Error(`bunorm: corrupt meta row — ${JSON.stringify(MetaCompiled.Errors(row))}`);
  }
  return result as MetaRecord;
}
```

### `src/timestamps.ts` — Timestamp Injection

Responsibilities:
- `resolveTimestampNames(config, meta)` → `{ createdAt: string | null, updatedAt: string | null }`
- Only injects if the column name is NOT already in the schema
- Default names: `"createdAt"`, `"updatedAt"`

---

## Files to Modify

### `src/table.ts`

Add `timestamps?: boolean | { createdAt?: string; updatedAt?: string }` to `TableDescriptor`.

### `src/repository.ts`

**Additions:**
1. Inject timestamps in `insert()`, `update()`, `upsert()`
2. `flush()` — `DELETE FROM` main table + all sub-tables
3. `drop()` — `DROP TABLE IF EXISTS` main table + all sub-tables

Timestamp injection logic:
```ts
const now = Date.now();
if (this._timestampNames.createdAt) obj[this._timestampNames.createdAt] = now;
if (this._timestampNames.updatedAt) obj[this._timestampNames.updatedAt] = now;
```

### `src/orm.ts`

**Additions:**
1. Write metadata on init:
   - `_schema_hash`: `Bun.hash(JSON.stringify(allSchemas))`
   - `_schema_compressed`: `Bun.deflateSync(schemaJson)`
   - `_tables`: `["inventory", "sales"]`
   - `_relations`: serialized `TypedRelation[]`
   - `_bunorm_version`: `"0.0.2"`
2. `flush(opts?: { includeMeta?: boolean })` on `BunORM`
3. `getMeta(key)` / `setMeta(key, value)` on `BunORM`

### `src/index.ts`

Export `MetaStore`, timestamp types, and any new utilities.

---

## API Surface

### Table-Level

```ts
table(SaleSchema, (s) => ({
  primaryKey: s.id,
  timestamps: true,                              // default names
  timestamps: { createdAt: "created_at" },       // override one
  timestamps: { createdAt: "c", updatedAt: "u" }, // override both
}))
```

### Repository-Level

```ts
orm.sales.flush();   // DELETE FROM "sales" + sub-tables
orm.sales.drop();    // DROP TABLE "sales" + sub-tables
```

### ORM-Level

```ts
orm.flush();                    // Flush all tables
orm.flush({ includeMeta: true }); // Flush all + wipe _bunorm_meta

orm.getMeta("_schema_hash");    // Uint8Array | null
orm.setMeta("custom_key", data); // Store arbitrary compressed data
```

---

## Tests to Add

```ts
test("timestamps auto-injected", () => {
  const orm = createORM({
    tables: {
      sales: table(SaleSchema, (s) => ({
        primaryKey: s.id,
        timestamps: true,
      })),
    },
  });
  const sale = orm.sales.insert({ id: "S1", status: "paid", total: 10, lineItems: [] });
  expect(sale.createdAt).toBeNumber();
  expect(sale.updatedAt).toBeNumber();
});

test("flush clears data but keeps schema", () => {
  orm.sales.insert({ id: "S1", status: "paid", total: 10, lineItems: [] });
  orm.sales.flush();
  expect(orm.sales.findById("S1")).toBeNull();
  // Schema still exists — can insert again
  orm.sales.insert({ id: "S1", status: "paid", total: 10, lineItems: [] });
  expect(orm.sales.findById("S1")).not.toBeNull();
});

test("schema hash stored in meta", () => {
  const hash = orm.getMetaString("_schema_hash");
  expect(hash).not.toBeNull();
});
```

---

## Edge Cases

| Case | Behavior |
|------|----------|
| User already has `createdAt` in schema | `timestamps: true` skips injecting `createdAt`; only injects `updatedAt` if not present |
| `flush()` on empty table | No-op (DELETE FROM is safe) |
| `drop()` then re-run `createORM` | Table gets recreated via `CREATE TABLE IF NOT EXISTS` |
| Corrupt `_bunorm_meta` row | `MetaStore.validate()` throws with `MetaCompiled.Errors()` details |
| `includeMeta: true` on flush | Meta table is wiped; next `createORM` boot rewrites fresh metadata |

---

## Performance Notes

- `Schema.Compile(MetaRecordSchema)` is done once at module load — negligible cost
- `Bun.deflateSync` on schema JSON is ~1-2ms for typical schemas; only runs once per `createORM()`
- `Bun.inflateSync` on read is sub-millisecond; only needed if we inspect stored schema
- `Bun.hash` is xxhash-based — fastest possible hash for comparison

---

## Future-Proofing for Part 2

The `_bunorm_meta` table is the foundation for migrations. Part 2 will add:
- `_bunorm_migrations` table (migration tracking)
- Schema diff engine (compare `_schema_compressed` with current schema)
- `sync` policy in `createORM()` (auto-apply safe changes, error on unsafe)

Storing the full compressed schema now means Part 2 can deserialize the old schema and run a diff without requiring the user to keep old TypeBox schemas in their codebase.

---

## Execution Order

| Step | File | Action |
|------|------|--------|
| 1 | `src/meta.ts` | Create `MetaStore` with compiled validation |
| 2 | `src/timestamps.ts` | Create timestamp utilities |
| 3 | `src/table.ts` | Add `timestamps` option |
| 4 | `src/repository.ts` | Inject timestamps; add `flush()` / `drop()` |
| 5 | `src/orm.ts` | Write metadata on init; add `flush()`, `getMeta`, `setMeta` |
| 6 | `src/index.ts` | Export new symbols |
| 7 | `example.ts` | Demo timestamps, flush, metadata |
| 8 | `tests/entity.test.ts` | Add tests |
