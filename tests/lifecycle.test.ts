import { describe, test, expect } from "bun:test";
import { LifecycleManager } from "../src/lifecycle.ts";

describe("LifecycleManager", () => {
  test("runs start hooks in order", async () => {
    const order: string[] = [];
    const lm = new LifecycleManager();
    lm.onStart(() => { order.push("a"); });
    lm.onStart(() => { order.push("b"); });
    await lm.runStart({} as any);
    expect(order).toEqual(["a", "b"]);
  });

  test("runReady sets ready flag", async () => {
    const lm = new LifecycleManager();
    expect(lm.isReady).toBe(false);
    await lm.runReady({} as any);
    expect(lm.isReady).toBe(true);
  });

  test("runShutdown runs once", async () => {
    const lm = new LifecycleManager();
    let count = 0;
    lm.onShutdown(() => count++);
    await lm.runShutdown({} as any);
    await lm.runShutdown({} as any);
    expect(count).toBe(1);
  });
});
