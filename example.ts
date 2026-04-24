/**
 * bunorm — usage example
 * Demonstrates: sales + inventory with sub-tables, typed column refs,
 * relations builder, lazy materialization, batch materialization,
 * typed filters, pagination, upsert, and clean serialization.
 */

import {
  Object, String, Number, Integer, Boolean, Array, Optional, Literal,
  type Static,
} from "typebox";
import { createORM, table } from "./src/index.ts";

// ─── 1. Define schemas ────────────────────────────────────────────────────────

const InventoryItemSchema = Object({
  sku: String(),
  name: String(),
  description: Optional(String()),
  price: Number(),
  stock: Integer(),
  category: String(),
  active: Boolean(),
});

type InventoryItem = Static<typeof InventoryItemSchema>;

const EventSchema = Object({
  id: String(),
  name: String(),
  status: String(),
});

// ---

const LineItemSchema = Object({
  itemNumber: String(),
  quantity: Integer(),
  unitPrice: Number(),
  discount: Optional(Number()),
});

const SaleSchema = Object({
  id: String(),
  customerId: String(),
  status: String(),
  total: Number(),
  createdAt: Integer(),
  lineItems: Array(LineItemSchema),
});

type Sale = Static<typeof SaleSchema>;

// ─── 2. Create ORM with typed column refs ─────────────────────────────────────

const orm = createORM({
  path: "shop.db",
  tables: {
    inventory: table(InventoryItemSchema, (s) => ({
      primaryKey: s.sku,
      indexes: [
        { columns: [s.category] },
        { columns: [s.active] },
        { columns: [s.category, s.active], name: "idx_inventory_cat_active" },
      ],
    })),
    sales: table(SaleSchema, (s) => ({
      primaryKey: s.id,
      indexes: [
        { columns: [s.customerId] },
        { columns: [s.status] },
        { columns: [s.createdAt] },
        { columns: [s.customerId, s.status] },
      ],
    })),
  },
  relations: (r) => [
    r.from("sales")
      .subTable("lineItems", "itemNumber")
      .to("inventory", "sku", { as: "inventory" }),
  ],
});

// ─── 3. Seed inventory ────────────────────────────────────────────────────────

orm.transaction(() => {
  orm.inventory.insert({
    sku: "WIDGET-A",
    name: "Widget Alpha",
    description: "A fine widget",
    price: 9.99,
    stock: 100,
    category: "widgets",
    active: true,
  });

  orm.inventory.insert({
    sku: "GADGET-B",
    name: "Gadget Beta",
    price: 24.99,
    stock: 50,
    category: "gadgets",
    active: true,
  });

  orm.inventory.insert({
    sku: "GIZMO-C",
    name: "Gizmo Gamma",
    price: 4.99,
    stock: 200,
    category: "gizmos",
    active: false,
  });
});

// ─── 4. Insert sales with sub-table line items ────────────────────────────────

const sale1 = orm.sales.insert({
  id: "SALE-001",
  customerId: "CUST-42",
  status: "paid",
  total: 44.97,
  createdAt: Date.now(),
  lineItems: [
    { itemNumber: "WIDGET-A", quantity: 3, unitPrice: 9.99 },
    { itemNumber: "GADGET-B", quantity: 1, unitPrice: 24.99, discount: 5 },
  ],
});

const sale2 = orm.sales.insert({
  id: "SALE-002",
  customerId: "CUST-99",
  status: "pending",
  total: 9.99,
  createdAt: Date.now(),
  lineItems: [
    { itemNumber: "GIZMO-C", quantity: 2, unitPrice: 4.99 },
  ],
});

console.log("Inserted sales:", sale1.id, sale2.id);

// ─── 5. Typed queries ─────────────────────────────────────────────────────────

// Find by PK — sub-table lineItems hydrated automatically
const fetched = orm.sales.findById("SALE-001");
console.log("\nFetched SALE-001:", fetched?.status);
console.log("Line items:", fetched?.lineItems.length, "items");
console.log("Schema hash present:", orm.meta.schemaHash !== null);

// Typed WHERE filter
const paidSales = orm.sales.findMany({
  where: { status: { eq: "paid" } },
  orderBy: { column: "createdAt", direction: "DESC" },
});
console.log("\nPaid sales:", paidSales.length);

// Paginated + count
const page = orm.sales.findPage({
  where: { customerId: { eq: "CUST-42" } },
  limit: 10,
  offset: 0,
});
console.log(`\nPage: ${page.data.length} of ${page.total} total`);

// Count
const pendingCount = orm.sales.count({ status: { eq: "pending" } });
console.log("Pending sales:", pendingCount);

// ─── 6. Update ────────────────────────────────────────────────────────────────

const updated = orm.sales.update({
  id: "SALE-002",
  status: "paid",
  total: 14.99,
  lineItems: [
    { itemNumber: "GIZMO-C", quantity: 3, unitPrice: 4.99 },
  ],
});
console.log("\nUpdated SALE-002 status:", updated?.status);

// ─── 7. Upsert inventory ──────────────────────────────────────────────────────

orm.inventory.upsert({
  data: {
    sku: "WIDGET-A",
    name: "Widget Alpha v2",
    price: 11.99,
    stock: 95,
    category: "widgets",
    active: true,
  },
  conflictTarget: "sku",
  update: ["name", "price", "stock"],
});

const updatedWidget = orm.inventory.findById("WIDGET-A");
console.log("\nUpserted widget price:", updatedWidget?.price);

// ─── 8. Materialization — resolve cross-table FKs ─────────────────────────────

const saleForMat = orm.sales.findById("SALE-001")!;
const materialized = saleForMat.materialize();

console.log("\nMaterialized SALE-001 line items with resolved inventory:");
for (const li of materialized.lineItems) {
  console.log(
    ` - ${li.itemNumber} x${li.quantity} → resolved: ${li.inventory?.name ?? "NOT FOUND"}`
  );
}

// Batch materialize (N+1 safe)
const allSales = orm.sales.findManyMaterialized();
console.log("\nBatch materialized", allSales.length, "sales");

// ─── 9. Serialization stays clean ─────────────────────────────────────────────

console.log("\nJSON.stringify(saleForMat):");
console.log(JSON.stringify(saleForMat, null, 2));

console.log("\nJSON.stringify(saleForMat.materialize()):");
console.log(JSON.stringify(saleForMat.materialize(), null, 2));

// ─── 10. Multi-column index + range filter ───────────────────────────────────

const activeWidgets = orm.inventory.findMany({
  where: {
    category: { eq: "widgets" },
    active: { eq: true },
    price: { lte: 20 },
  },
  orderBy: { column: "price", direction: "ASC" },
});
console.log("\nActive cheap widgets:", activeWidgets.length);

// ─── 11. Delete ───────────────────────────────────────────────────────────────

const deleted = orm.sales.deleteById("SALE-002");
console.log("\nDeleted SALE-002:", deleted);
console.log("Remaining sales:", orm.sales.count());

// ─── 12. Cleanup ──────────────────────────────────────────────────────────────
orm.close();
console.log("\nDone — db closed cleanly.");

// ─── 13. Timestamps demo ──────────────────────────────────────────────────────

const tsORM = createORM({
  path: "shop_timestamps.db",
  tables: {
    events: table(EventSchema, (s) => ({
      primaryKey: s.id,
      timestamps: true,
    })),
  },
});

const event = tsORM.events.insert({ id: "E1", name: "Launch", status: "active" });
console.log("\nEvent createdAt:", event.createdAt);
console.log("Event updatedAt:", event.updatedAt);

// ─── 14. Flush demo ───────────────────────────────────────────────────────────

tsORM.events.insert({ id: "E2", name: "Cleanup", status: "done" });
console.log("Events before flush:", tsORM.events.count());
tsORM.events.flush();
console.log("Events after flush:", tsORM.events.count());

tsORM.close();
