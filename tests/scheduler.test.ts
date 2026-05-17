import { describe, test, expect } from "bun:test";
import { TableScheduler } from "../src/scheduler.ts";

describe("TableScheduler", () => {
  test("runs scheduled task", async () => {
    const s = new TableScheduler();
    let count = 0;
    s.schedule("x", 10, () => count++);
    await new Promise((r) => setTimeout(r, 35));
    expect(count).toBeGreaterThanOrEqual(2);
    s.clearAll();
  });

  test("clearAll stops tasks", async () => {
    const s = new TableScheduler();
    let count = 0;
    s.schedule("x", 10, () => count++);
    s.clearAll();
    const before = count;
    await new Promise((r) => setTimeout(r, 30));
    expect(count).toBe(before);
  });
});
