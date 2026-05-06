import { test, expect } from "bun:test";
import { Type } from "typebox";
import { createORM, table } from "../src/index.ts";

const NestedSchema = Type.Object({
  id: Type.Number(),
  pricing: Type.Object({ total: Type.Number(), currency: Type.String() }),
  status: Type.Object({ group: Type.String(), blocked: Type.Boolean() }),
});

function makeORM() {
  return createORM({
    path: ":memory:",
    rebuildOnLaunch: true,
    tables: {
      nested: table(NestedSchema, (s) => ({ primaryKey: s.id })),
    },
  });
}

test("direct nested object eq filter returns matching rows", () => {
  const orm = makeORM();
  orm.nested.insert({
    id: 1,
    pricing: { total: 100, currency: "DKK" },
    status: { group: "active", blocked: false },
  });
  orm.nested.insert({
    id: 2,
    pricing: { total: 200, currency: "EUR" },
    status: { group: "inactive", blocked: true },
  });

  const results = orm.nested.findMany({
    where: { pricing: { eq: { total: 100, currency: "DKK" } } },
  });

  expect(results).toHaveLength(1);
  expect(results[0]!.id).toBe(1);
  orm._close();
});

test("direct nested object ne filter returns non-matching rows", () => {
  const orm = makeORM();
  orm.nested.insert({
    id: 1,
    pricing: { total: 100, currency: "DKK" },
    status: { group: "active", blocked: false },
  });
  orm.nested.insert({
    id: 2,
    pricing: { total: 200, currency: "EUR" },
    status: { group: "inactive", blocked: true },
  });

  const results = orm.nested.findMany({
    where: { pricing: { ne: { total: 100, currency: "DKK" } } },
  });

  expect(results).toHaveLength(1);
  expect(results[0]!.id).toBe(2);
  orm._close();
});

test("dotted path eq filter returns matching rows", () => {
  const orm = makeORM();
  orm.nested.insert({
    id: 1,
    pricing: { total: 100, currency: "DKK" },
    status: { group: "active", blocked: false },
  });
  orm.nested.insert({
    id: 2,
    pricing: { total: 200, currency: "EUR" },
    status: { group: "inactive", blocked: true },
  });

  const results = orm.nested.findMany({
    where: { "pricing.total": { eq: 100 } },
  });

  expect(results).toHaveLength(1);
  expect(results[0]!.id).toBe(1);
  orm._close();
});
