import { describe, test, expect } from "bun:test";
import { Object, String, Number, Integer } from "typebox";
import { EventBus } from "../src/events.ts";
import { createORM, table } from "../src/index.ts";

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

const ItemSchema = Object({
  sku: String(),
  name: String(),
  price: Number(),
  stock: Integer(),
});

describe("Repository events", () => {
  test("insert emits event with data", () => {
    const orm = createORM({
      path: ":memory:",
      tables: {
        inventory: table(ItemSchema, (s) => ({ primaryKey: s.sku })),
      },
    });

    let received: any;
    orm._events.on("inventory", "insert", (e) => { received = e; });

    orm.inventory.insert({ sku: "A", name: "Widget", price: 9.99, stock: 10 });
    expect(received).not.toBeUndefined();
    expect(received.table).toBe("inventory");
    expect(received.operation).toBe("insert");
    expect(received.data.sku).toBe("A");
    orm._close();
  });

  test("broad write event fires on insert", () => {
    const orm = createORM({
      path: ":memory:",
      tables: {
        inventory: table(ItemSchema, (s) => ({ primaryKey: s.sku })),
      },
    });

    let received: any;
    orm._events.on("inventory", "write", (e) => { received = e; });

    orm.inventory.insert({ sku: "B", name: "Gadget", price: 24.99, stock: 5 });
    expect(received).not.toBeUndefined();
    expect(received.operation).toBe("write");
    orm._close();
  });

  test("findById emits read event", () => {
    const orm = createORM({
      path: ":memory:",
      tables: {
        inventory: table(ItemSchema, (s) => ({ primaryKey: s.sku })),
      },
    });

    orm.inventory.insert({ sku: "C", name: "Thing", price: 1, stock: 1 });

    let received: any;
    orm._events.on("inventory", "read", (e) => { received = e; });

    orm.inventory.findById("C");
    expect(received).not.toBeUndefined();
    expect(received.operation).toBe("read");
    orm._close();
  });
});
