import { test, expect } from "bun:test";
import { buildWhere } from "../src/query-builder.ts";
import { Type } from "typebox";

const TestSchema = Type.Object({
  name: Type.String(),
  age: Type.Number(),
  status: Type.String(),
});

test("AND/OR nested where", () => {
  const result = buildWhere({
    AND: [
      { name: { eq: "alice" } },
      { OR: [
        { age: { gt: 18 } },
        { status: { eq: "active" } }
      ]}
    ]
  });
  expect(result.sql).toContain("AND");
  expect(result.sql).toContain("OR");
  expect(result.params).toEqual(["alice", 18, "active"]);
});

test("NOT wrapper", () => {
  const result = buildWhere({
    NOT: { name: { eq: "bob" } }
  });
  expect(result.sql).toBe('WHERE NOT ("name" = ?)');
  expect(result.params).toEqual(["bob"]);
});
