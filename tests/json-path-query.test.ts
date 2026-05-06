import { test, expect } from "bun:test";
import { Type } from "typebox";
import { buildWhere } from "../src/query-builder.ts";

const NestedSchema = Type.Object({
  id: Type.Number(),
  pricing: Type.Object({
    total: Type.Number(),
    currency: Type.String(),
  }),
  status: Type.Object({
    group: Type.String(),
    blocked: Type.Boolean(),
  }),
});

const Depth2Schema = Type.Object({
  id: Type.Number(),
  address: Type.Object({
    city: Type.Object({
      zip: Type.Number(),
      name: Type.String(),
    }),
  }),
});

test("JSON_EXTRACT for nested object path", () => {
  const result = buildWhere<typeof NestedSchema>({
    "pricing.total": { gt: 100 }
  });
  expect(result.sql).toBe('WHERE JSON_EXTRACT("pricing", \'$.total\') > ?');
  expect(result.params).toEqual([100]);
});

test("JSON_EXTRACT for deeply nested path", () => {
  const result = buildWhere<typeof NestedSchema>({
    "status.group": { eq: "active" }
  });
  expect(result.sql).toBe('WHERE JSON_EXTRACT("status", \'$.group\') = ?');
  expect(result.params).toEqual(["active"]);
});

test("JSON_EXTRACT works with all filter operators", () => {
  const eqResult = buildWhere<typeof NestedSchema>({ "pricing.currency": { eq: "DKK" } });
  expect(eqResult.sql).toBe('WHERE JSON_EXTRACT("pricing", \'$.currency\') = ?');
  expect(eqResult.params).toEqual(["DKK"]);

  const neResult = buildWhere<typeof NestedSchema>({ "pricing.currency": { ne: "EUR" } });
  expect(neResult.sql).toBe('WHERE JSON_EXTRACT("pricing", \'$.currency\') != ?');
  expect(neResult.params).toEqual(["EUR"]);

  const gteResult = buildWhere<typeof NestedSchema>({ "pricing.total": { gte: 50 } });
  expect(gteResult.sql).toBe('WHERE JSON_EXTRACT("pricing", \'$.total\') >= ?');
  expect(gteResult.params).toEqual([50]);

  const ltResult = buildWhere<typeof NestedSchema>({ "pricing.total": { lt: 200 } });
  expect(ltResult.sql).toBe('WHERE JSON_EXTRACT("pricing", \'$.total\') < ?');
  expect(ltResult.params).toEqual([200]);

  const lteResult = buildWhere<typeof NestedSchema>({ "pricing.total": { lte: 200 } });
  expect(lteResult.sql).toBe('WHERE JSON_EXTRACT("pricing", \'$.total\') <= ?');
  expect(lteResult.params).toEqual([200]);

  const likeResult = buildWhere<typeof NestedSchema>({ "status.group": { like: "%active%" } });
  expect(likeResult.sql).toBe('WHERE JSON_EXTRACT("status", \'$.group\') LIKE ?');
  expect(likeResult.params).toEqual(["%active%"]);

  const betweenResult = buildWhere<typeof NestedSchema>({ "pricing.total": { between: [10, 100] } });
  expect(betweenResult.sql).toBe('WHERE JSON_EXTRACT("pricing", \'$.total\') BETWEEN ? AND ?');
  expect(betweenResult.params).toEqual([10, 100]);

  const inResult = buildWhere<typeof NestedSchema>({ "pricing.currency": { in: ["DKK", "EUR"] } });
  expect(inResult.sql).toBe('WHERE JSON_EXTRACT("pricing", \'$.currency\') IN (?, ?)');
  expect(inResult.params).toEqual(["DKK", "EUR"]);

  const notInResult = buildWhere<typeof NestedSchema>({ "pricing.currency": { notIn: ["USD"] } });
  expect(notInResult.sql).toBe('WHERE JSON_EXTRACT("pricing", \'$.currency\') NOT IN (?)');
  expect(notInResult.params).toEqual(["USD"]);

  const isNullResult = buildWhere<typeof NestedSchema>({ "pricing.total": { isNull: true } });
  expect(isNullResult.sql).toBe('WHERE JSON_EXTRACT("pricing", \'$.total\') IS NULL');
  expect(isNullResult.params).toEqual([]);

  const isNotNullResult = buildWhere<typeof NestedSchema>({ "pricing.total": { isNotNull: true } });
  expect(isNotNullResult.sql).toBe('WHERE JSON_EXTRACT("pricing", \'$.total\') IS NOT NULL');
  expect(isNotNullResult.params).toEqual([]);
});

test("JSON_EXTRACT combined with regular column filters", () => {
  const result = buildWhere<typeof NestedSchema>({
    id: { eq: 1 },
    "pricing.total": { gt: 100 }
  });
  expect(result.sql).toBe('WHERE "id" = ? AND JSON_EXTRACT("pricing", \'$.total\') > ?');
  expect(result.params).toEqual([1, 100]);
});

test("JSON_EXTRACT inside logical operators", () => {
  const result = buildWhere<typeof NestedSchema>({
    AND: [
      { "pricing.total": { gt: 100 } },
      { "status.group": { eq: "active" } }
    ]
  });
  expect(result.sql).toBe('WHERE (JSON_EXTRACT("pricing", \'$.total\') > ?) AND (JSON_EXTRACT("status", \'$.group\') = ?)');
  expect(result.params).toEqual([100, "active"]);
});

test("JSON_EXTRACT inside OR with dotted paths", () => {
  const result = buildWhere<typeof NestedSchema>({
    OR: [
      { "pricing.total": { gt: 100 } },
      { "status.group": { eq: "active" } }
    ]
  });
  expect(result.sql).toBe('WHERE (JSON_EXTRACT("pricing", \'$.total\') > ? OR JSON_EXTRACT("status", \'$.group\') = ?)');
  expect(result.params).toEqual([100, "active"]);
});

test("JSON_EXTRACT inside NOT with dotted path", () => {
  const result = buildWhere<typeof NestedSchema>({
    NOT: { "pricing.total": { gt: 100 } }
  });
  expect(result.sql).toBe('WHERE NOT (JSON_EXTRACT("pricing", \'$.total\') > ?)');
  expect(result.params).toEqual([100]);
});

test("JSON_EXTRACT escapes single quotes in path to prevent SQL injection", () => {
  const result = buildWhere<typeof NestedSchema>({
    "pricing.total': --": { eq: "malicious" }
  } as any);
  expect(result.sql).toBe('WHERE JSON_EXTRACT("pricing", \'$.total\'\': --\') = ?');
  expect(result.params).toEqual(["malicious"]);
});

test("JSON_EXTRACT escapes double quotes in column name", () => {
  const result = buildWhere<typeof NestedSchema>({
    "pricing\"injected.total": { eq: "malicious" }
  } as any);
  expect(result.sql).toBe('WHERE JSON_EXTRACT("pricing""injected", \'$.total\') = ?');
  expect(result.params).toEqual(["malicious"]);
});

test("direct nested object eq serializes parameter as JSON", () => {
  const result = buildWhere<typeof NestedSchema>({
    pricing: { eq: { total: 100, currency: "DKK" } }
  });
  expect(result.sql).toBe('WHERE "pricing" = ?');
  expect(result.params).toEqual([JSON.stringify({ total: 100, currency: "DKK" })]);
});

test("direct nested object ne serializes parameter as JSON", () => {
  const result = buildWhere<typeof NestedSchema>({
    pricing: { ne: { total: 100, currency: "DKK" } }
  });
  expect(result.sql).toBe('WHERE "pricing" != ?');
  expect(result.params).toEqual([JSON.stringify({ total: 100, currency: "DKK" })]);
});

test("JSON_EXTRACT for depth-2 nested path", () => {
  const result = buildWhere<typeof Depth2Schema>({
    "address.city.zip": { eq: 12345 }
  });
  expect(result.sql).toBe('WHERE JSON_EXTRACT("address", \'$.city.zip\') = ?');
  expect(result.params).toEqual([12345]);
});

test("JSON_EXTRACT for depth-2 path with gt operator", () => {
  const result = buildWhere<typeof Depth2Schema>({
    "address.city.zip": { gt: 10000 }
  });
  expect(result.sql).toBe('WHERE JSON_EXTRACT("address", \'$.city.zip\') > ?');
  expect(result.params).toEqual([10000]);
});

test("JSON_EXTRACT for depth-2 path with like operator", () => {
  const result = buildWhere<typeof Depth2Schema>({
    "address.city.name": { like: "%York%" }
  });
  expect(result.sql).toBe('WHERE JSON_EXTRACT("address", \'$.city.name\') LIKE ?');
  expect(result.params).toEqual(["%York%"]);
});

test("JSON_EXTRACT for depth-2 path with in operator", () => {
  const result = buildWhere<typeof Depth2Schema>({
    "address.city.zip": { in: [12345, 67890] }
  });
  expect(result.sql).toBe('WHERE JSON_EXTRACT("address", \'$.city.zip\') IN (?, ?)');
  expect(result.params).toEqual([12345, 67890]);
});

test("JSON_EXTRACT for depth-2 path combined with regular column", () => {
  const result = buildWhere<typeof Depth2Schema>({
    id: { eq: 1 },
    "address.city.zip": { eq: 12345 }
  });
  expect(result.sql).toBe('WHERE "id" = ? AND JSON_EXTRACT("address", \'$.city.zip\') = ?');
  expect(result.params).toEqual([1, 12345]);
});

test("JSON_EXTRACT for depth-2 path inside logical operators", () => {
  const result = buildWhere<typeof Depth2Schema>({
    AND: [
      { "address.city.zip": { eq: 12345 } },
      { "address.city.name": { eq: "New York" } }
    ]
  });
  expect(result.sql).toBe('WHERE (JSON_EXTRACT("address", \'$.city.zip\') = ?) AND (JSON_EXTRACT("address", \'$.city.name\') = ?)');
  expect(result.params).toEqual([12345, "New York"]);
});
