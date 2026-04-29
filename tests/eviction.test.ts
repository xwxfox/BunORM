import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { Object, String, Integer } from "typebox";
import { createORM, table } from "../src/index.ts";

const CacheSchema = Object({
  id: String(),
  data: String(),
  createdAt: Integer(),
  lastAccessedAt: Integer(),
});

function makeORM() {
  return createORM({
    tables: {
      cache: table(CacheSchema, (s) => ({
        primaryKey: s.id,
        eviction: { maxRows: 5, ttlColumn: "createdAt", ttlMs: 100, lruColumn: "lastAccessedAt" },
      })),
    },
  });
}

describe("bounded tables", () => {
  let orm: ReturnType<typeof makeORM>;
  beforeEach(() => { orm = makeORM(); });
  afterEach(() => orm._close());

  test("eviction removes rows over maxRows", () => {
    for (let i = 0; i < 10; i++) {
      orm.cache.insert({ id: `${i}`, data: "x", createdAt: Date.now(), lastAccessedAt: Date.now() });
    }
    // Force sweep
    (orm.cache as any)._runEviction();
    expect(orm.cache.count()).toBeLessThanOrEqual(5);
  });
});
