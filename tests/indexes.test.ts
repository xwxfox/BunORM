import { describe, test, expect } from "bun:test";
import { Object, String, Integer } from "typebox";
import { createORM, table } from "../src/index.ts";

const Schema = Object({ id: String(), status: String(), createdAt: Integer() });

describe("partial indexes", () => {
  test("creates index with WHERE clause", () => {
    const orm = createORM({
      tables: {
        logs: table(Schema, (s) => ({
          primaryKey: s.id,
          indexes: [{ columns: [s.status], where: "status = 'error'", include: [s.createdAt] }],
        })),
      },
    });
    const indexes = orm.logs.raw(`SELECT sql FROM sqlite_master WHERE type = 'index' AND tbl_name = 'logs'`);
    expect(indexes.some((r: any) => r.sql?.includes("WHERE"))).toBe(true);
    orm._close();
  });
});
