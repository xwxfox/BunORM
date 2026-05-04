import { test, expect } from "bun:test";
import { buildWhere } from "../src/query-builder.ts";
import { Type } from "typebox";

const TestSchema = Type.Object({
  name: Type.String(),
  age: Type.Number(),
  status: Type.String(),
});

test("AND/OR nested where", () => {
  const result = buildWhere<typeof TestSchema>({
    AND: [
      { name: { eq: "alice" } },
      { OR: [
        { age: { gt: 18 } },
        { status: { eq: "active" } }
      ]}
    ]
  });
  expect(result.sql).toBe('WHERE ("name" = ?) AND (("age" > ? OR "status" = ?))');
  expect(result.params).toEqual(["alice", 18, "active"]);
});

test("NOT wrapper", () => {
  const result = buildWhere<typeof TestSchema>({
    NOT: { name: { eq: "bob" } }
  });
  expect(result.sql).toBe('WHERE NOT ("name" = ?)');
  expect(result.params).toEqual(["bob"]);
});

test("empty AND returns empty SQL", () => {
  const result = buildWhere<typeof TestSchema>({ AND: [] });
  expect(result.sql).toBe("");
  expect(result.params).toEqual([]);
});

test("mixed logical ops + column filters at same level", () => {
  const result = buildWhere<typeof TestSchema>({
    AND: [{ age: { gte: 18 } }],
    name: { eq: "x" },
  });
  expect(result.sql).toBe('WHERE ("age" >= ?) AND "name" = ?');
  expect(result.params).toEqual([18, "x"]);
});

test("nested NOT", () => {
  const result = buildWhere<typeof TestSchema>({
    NOT: { NOT: { name: { eq: "x" } } }
  });
  expect(result.sql).toBe('WHERE NOT (NOT ("name" = ?))');
  expect(result.params).toEqual(["x"]);
});
