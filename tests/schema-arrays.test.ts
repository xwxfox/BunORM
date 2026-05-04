import { test, expect } from "bun:test";
import { Type } from "typebox";
import { introspectTable } from "../src/schema.ts";

const SchemaWithPrimitiveArrays = Type.Object({
  id: Type.Number(),
  tags: Type.Array(Type.String()),
  scores: Type.Array(Type.Number()),
});

test("arrays of primitives should get a TEXT column", () => {
  const meta = introspectTable("test", SchemaWithPrimitiveArrays as any);
  const tagsCol = meta.columns.find(c => c.name === "tags");
  const scoresCol = meta.columns.find(c => c.name === "scores");
  expect(tagsCol).toBeDefined();
  expect(tagsCol?.sqlType).toBe("TEXT");
  expect(scoresCol).toBeDefined();
  expect(scoresCol?.sqlType).toBe("TEXT");
});
