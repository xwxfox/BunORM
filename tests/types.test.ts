/**
 * foxdb/tests/types.test.ts
 * Compile-time type safety checks.
 * If this file compiles with tsc --noEmit, all tests pass.
 */

import { Object, String, Number, Integer, Optional, Array } from "typebox";
import { table } from "../src/table.ts";
import { createColumnProxy } from "../src/columns.ts";

const ItemSchema = Object({
  sku: String(),
  name: String(),
  price: Number(),
  stock: Integer(),
});

// ─── Valid config ─────────────────────────────────────────────────────────────

const valid = table(ItemSchema, (s) => ({
  primaryKey: s.sku,
  indexes: [{ columns: [s.name, s.price] }],
}));

void valid;

// ─── Invalid primaryKey should error at property access ───────────────────────

const cols = createColumnProxy(ItemSchema);
// @ts-expect-error - "nonExistent" is not a scalar column
void cols.nonExistent;

// ─── Invalid index column should error at property access ─────────────────────

// @ts-expect-error - "nonExistent" is not a scalar column
void cols.nonExistent;

// ─── Sub-table in index should error ──────────────────────────────────────────

const WithSub = Object({
  id: String(),
  tags: Array(Object({ label: String() })),
});

const subCols = createColumnProxy(WithSub);
// @ts-expect-error - tags is an array (sub-table), not a scalar
void subCols.tags;
