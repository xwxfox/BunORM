/**
 * bunorm/tests/entity.test.ts
 * Runtime tests for entity wrapping, materialization, and serialization.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { Object, String, Number, Integer, Array } from "typebox";
import { createORM, table } from "../src/index.ts";

const ItemSchema = Object({
  sku: String(),
  name: String(),
  price: Number(),
  stock: Integer(),
});

const LineItemSchema = Object({
  itemNumber: String(),
  quantity: Integer(),
  unitPrice: Number(),
});

const SaleSchema = Object({
  id: String(),
  status: String(),
  total: Number(),
  lineItems: Array(LineItemSchema),
});

describe("BunORM", () => {
  let orm: ReturnType<typeof createORM>;

  beforeEach(() => {
    orm = createORM({
      tables: {
        inventory: table(ItemSchema, (s) => ({
          primaryKey: s.sku,
          indexes: [{ columns: [s.name] }],
        })),
        sales: table(SaleSchema, (s) => ({
          primaryKey: s.id,
          indexes: [{ columns: [s.status] }],
        })),
      },
      relations: (r) => [
        r.from("sales")
          .subTable("lineItems", "itemNumber")
          .to("inventory", "sku", { as: "inventory" }),
      ],
    });

    orm.inventory.insert({ sku: "A", name: "Widget", price: 9.99, stock: 10 });
    orm.inventory.insert({ sku: "B", name: "Gadget", price: 24.99, stock: 5 });
  });

  afterEach(() => {
    orm.close();
  });

  test("insert and findById", () => {
    const sale = orm.sales.insert({
      id: "S1",
      status: "paid",
      total: 9.99,
      lineItems: [{ itemNumber: "A", quantity: 1, unitPrice: 9.99 }],
    });

    const found = orm.sales.findById("S1");
    expect(found).not.toBeNull();
    expect(found!.id).toBe("S1");
    expect(found!.lineItems).toHaveLength(1);
  });

  test("entity serialization is clean", () => {
    const sale = orm.sales.insert({
      id: "S2",
      status: "pending",
      total: 5,
      lineItems: [{ itemNumber: "B", quantity: 2, unitPrice: 2.5 }],
    });

    const found = orm.sales.findById("S2")!;
    const json = JSON.stringify(found);
    const parsed = JSON.parse(json);

    expect(parsed.id).toBe("S2");
    expect(parsed.status).toBe("pending");
    expect(parsed.lineItems).toHaveLength(1);
    expect("materialize" in parsed).toBe(false);
    expect("related" in parsed).toBe(false);
  });

  test("materialize adds related proxy", () => {
    const sale = orm.sales.insert({
      id: "S3",
      status: "paid",
      total: 9.99,
      lineItems: [{ itemNumber: "A", quantity: 1, unitPrice: 9.99 }],
    });

    const found = orm.sales.findById("S3")!;
    const mat = found.materialize();

    const li = mat.lineItems[0] as Record<string, unknown> & { related: { inventory: { name: string } | null } };
    expect(li.related.inventory).not.toBeNull();
    expect(li.related.inventory!.name).toBe("Widget");
  });

  test("findManyMaterialized returns batch resolved records", () => {
    orm.sales.insert({
      id: "S4",
      status: "paid",
      total: 9.99,
      lineItems: [{ itemNumber: "A", quantity: 1, unitPrice: 9.99 }],
    });
    orm.sales.insert({
      id: "S5",
      status: "paid",
      total: 24.99,
      lineItems: [{ itemNumber: "B", quantity: 1, unitPrice: 24.99 }],
    });

    const all = orm.sales.findManyMaterialized();
    expect(all).toHaveLength(2);

    const mat = all[0].materialize();
    const li = mat.lineItems[0] as Record<string, unknown> & { related: { inventory: { name: string } | null } };
    expect(li.related.inventory).not.toBeNull();
    expect(li.related.inventory!.name).toBe("Widget");
  });

  test("tables without relations omit materialize", () => {
    const item = orm.inventory.findById("A")!;
    expect("materialize" in item).toBe(false);
  });

  test("update and delete", () => {
    orm.sales.insert({
      id: "S6",
      status: "paid",
      total: 10,
      lineItems: [],
    });

    const updated = orm.sales.update({ id: "S6", status: "refunded", total: 0 });
    expect(updated).not.toBeNull();
    expect(updated!.status).toBe("refunded");

    const deleted = orm.sales.deleteById("S6");
    expect(deleted).toBe(true);
    expect(orm.sales.findById("S6")).toBeNull();
  });
});
