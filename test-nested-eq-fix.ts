import { Type } from "typebox";
import { createORM, table } from "./src/index.ts";

const NestedSchema = Type.Object({
  id: Type.Number(),
  pricing: Type.Object({ total: Type.Number(), currency: Type.String() }),
});

const nested = table(NestedSchema, (s) => ({ primaryKey: s.id }));
const orm = createORM({ path: ":memory:", rebuildOnLaunch: true, tables: { nested } });

orm.nested.insert({ id: 1, pricing: { total: 100, currency: "DKK" } });

// Query by direct nested object eq
const results = orm.nested.findMany({ where: { pricing: { eq: { total: 100, currency: "DKK" } } } });
console.log("Direct eq results:", JSON.stringify(results));
console.log("Direct eq count:", results.length);

// Query by dotted path
const dotted = orm.nested.findMany({ where: { "pricing.total": { eq: 100 } } });
console.log("Dotted path results:", JSON.stringify(dotted));
console.log("Dotted path count:", dotted.length);

// Query by ne
const neResults = orm.nested.findMany({ where: { pricing: { ne: { total: 999, currency: "USD" } } } });
console.log("NE results:", JSON.stringify(neResults));
console.log("NE count:", neResults.length);

orm._close();
