import { Type } from "typebox";
import { table } from "./src/table.ts";
import { createORM } from "./src/orm.ts";

const NestedSchema = Type.Object({
  id: Type.Number(),
  pricing: Type.Object({ total: Type.Number(), currency: Type.String() }),
  status: Type.Optional(Type.Object({ group: Type.String(), blocked: Type.Boolean() })),
});

const nested = table(NestedSchema, (s) => ({ primaryKey: s.id }));
const nestedOrm = createORM({ tables: { nested } });

// Should "status.group" work even if status is optional?
nestedOrm.nested.findMany({ where: { "status.group": { eq: "active" } } });

nestedOrm._close();
