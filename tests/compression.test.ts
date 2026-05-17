import { describe, test, expect } from "bun:test";
import { Object, String } from "typebox";
import { createORM, table } from "../src/index.ts";

const Schema = Object({ id: String(), payload: String() });

describe("compression", () => {
  test("round-trips large string via gzip", () => {
    const orm = createORM({
      tables: {
        logs: table(Schema, (s) => ({
          primaryKey: s.id,
          compression: { columns: [s.payload], algorithm: "gzip" },
        })),
      },
    });
    const big = "x".repeat(10000);
    orm.logs.insert({ id: "1", payload: big });
    const row = orm.logs.findById("1");
    expect(row!.payload).toBe(big);
    orm._close();
  });
});
