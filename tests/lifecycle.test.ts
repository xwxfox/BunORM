import { describe, test, expect } from "bun:test";
import { LifecycleManager } from "../src/lifecycle.ts";

describe("LifecycleManager", () => {
  test("runs start hooks in order", () => {
    const order: string[] = [];
    const lm = new LifecycleManager();
    lm.onStart(() => { order.push("a"); });
    lm.onStart(() => { order.push("b"); });
    lm.runStart({} as any);
    expect(order).toEqual(["a", "b"]);
  });

  test("runReady sets ready flag", () => {
    const lm = new LifecycleManager();
    expect(lm.isReady).toBe(false);
    lm.runReady({} as any);
    expect(lm.isReady).toBe(true);
  });

  test("runShutdown runs once", () => {
    const lm = new LifecycleManager();
    let count = 0;
    lm.onShutdown(() => { count++; });
    lm.runShutdown({} as any);
    lm.runShutdown({} as any);
    expect(count).toBe(1);
  });
});
