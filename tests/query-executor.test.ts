import { describe, test, expect } from "bun:test";
import { BunDatabase } from "../src/database.ts";
import { QueryExecutor } from "../src/query-executor.ts";

describe("QueryExecutor", () => {
  const db = new BunDatabase();
  db.exec(`CREATE TABLE "t" ("id" TEXT PRIMARY KEY, "val" INTEGER)`);
  db.prepare(`INSERT INTO "t" VALUES (?,?)`).run("a", 1);
  db.prepare(`INSERT INTO "t" VALUES (?,?)`).run("b", 2);

  test("all returns rows", () => {
    const ex = new QueryExecutor({ db, tableName: "t" });
    expect(ex.all(`SELECT * FROM "t"`)).toHaveLength(2);
  });

  test("metrics hook fires", () => {
    let captured: any;
    const ex = new QueryExecutor({ db, tableName: "t", metricsHook: (m) => { captured = m; } });
    ex.all(`SELECT * FROM "t"`, [], "findMany");
    expect(captured).toBeDefined();
    expect(captured.table).toBe("t");
    expect(captured.operation).toBe("findMany");
    expect(captured.rowCount).toBe(2);
    expect(captured.durationMs).toBeGreaterThanOrEqual(0);
  });
});
