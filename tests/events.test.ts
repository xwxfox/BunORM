import { describe, test, expect } from "bun:test";
import { EventBus } from "../src/events.ts";

describe("EventBus", () => {
  test("has() returns false when empty", () => {
    const bus = new EventBus();
    expect(bus.has("users.insert")).toBe(false);
    expect(bus.hasAny("users")).toBe(false);
  });

  test("emits only when listener exists", () => {
    const bus = new EventBus();
    let called = 0;
    const off = bus.on("users.insert", () => called++);
    expect(bus.has("users.insert")).toBe(true);
    expect(bus.hasAny("users")).toBe(true);

    bus.emit("users.insert", { id: 1 });
    expect(called).toBe(1);

    off();
    expect(bus.has("users.insert")).toBe(false);
  });

  test("wildcard table listener receives all table events", () => {
    const bus = new EventBus();
    const events: string[] = [];
    bus.on("users.*", (e) => events.push((e as any).op));
    bus.emit("users.insert", { op: "insert" });
    bus.emit("users.update", { op: "update" });
    expect(events).toEqual(["insert", "update"]);
  });
});
