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
console.log("Results:", JSON.stringify(results));
console.log("Count:", results.length);

orm._close();
