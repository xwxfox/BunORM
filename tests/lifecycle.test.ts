import { describe, test, expect } from "bun:test";
import { LifecycleManager } from "../src/lifecycle.ts";
import type { ORMContext } from "../src/lifecycle.ts";

function dummyCtx(): ORMContext {
  return {
    orm: {} as never,
    db: {} as never,
    meta: {} as never,
    tables: [],
    repos: new Map(),
    logger: { log: () => {}, error: () => {} },
  };
}

describe("LifecycleManager", () => {
  test("runs start hooks in order", () => {
    const order: string[] = [];
    const lm = new LifecycleManager();
    lm.onStart(() => { order.push("a"); });
    lm.onStart(() => { order.push("b"); });
    lm.runStart(dummyCtx());
    expect(order).toEqual(["a", "b"]);
  });

  test("runReady sets ready flag", () => {
    const lm = new LifecycleManager();
    expect(lm.isReady).toBe(false);
    lm.runReady(dummyCtx());
    expect(lm.isReady).toBe(true);
  });

  test("runShutdown runs once", () => {
    const lm = new LifecycleManager();
    let count = 0;
    lm.onShutdown(() => { count++; });
    lm.runShutdown(dummyCtx());
    lm.runShutdown(dummyCtx());
    expect(count).toBe(1);
  });
});
