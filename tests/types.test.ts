/**
 * foxdb/tests/types.test.ts
 * Compile-time type safety checks.
 * If this file compiles with tsc --noEmit, all tests pass.
 */

import { Object, String, Number, Integer, Optional, Array } from "typebox";
import { table } from "../src/table.ts";
import { createColumnProxy } from "../src/columns.ts";
import { createORM } from "../src/orm.ts";

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

  // ─── select projection narrows return type ────────────────────────────────────

function _compileTimeChecks() {
  const UserSchema = Object({ id: String(), name: String(), age: Number() });
  const users = table(UserSchema, (s) => ({ primaryKey: s.id }));
  const orm = createORM({ tables: { users } });

  const projected = orm.users.findMany({ select: ["id"] });
  // @ts-expect-error — name was not selected
  void projected[0].name;

  // ─── select + include preserves sub-table types ───────────────────────────────

  const OrderSchema = Object({
    id: String(),
    total: Number(),
    lineItems: Array(Object({ sku: String(), qty: Integer() })),
  });
  const orders = table(OrderSchema, (s) => ({ primaryKey: s.id }));
  const orderOrm = createORM({ tables: { orders } });

  const withItems = orderOrm.orders.findMany({ select: ["id", "total"], include: ["lineItems"] });
  const firstOrder = withItems[0]!;
  const _id: string = firstOrder.id;
  const _total: number = firstOrder.total;
  const _sku: string = firstOrder.lineItems[0]!.sku;
  // @ts-expect-error — name is not a scalar column on OrderSchema
  void firstOrder.name;
  // @ts-expect-error — lineItems[0].wrong is not a property
  void firstOrder.lineItems[0]!.wrong;

  orderOrm._close();

  // ─── iterate yields entities ──────────────────────────────────────────────────

  for (const u of orm.users.iterate()) {
    const _id: string = u.id;
    void _id;
  }

  // ─── aggregate returns dynamic shape ──────────────────────────────────────────

  const agg = orm.users.aggregate({ aggregations: { total: { sum: "age" } } });
  // @ts-expect-error — wrong aggregation alias
  void agg[0].wrong;

  orm._close();
}
