import { describe, expect, it } from "bun:test";
import { GzipCodec, JsonCodec } from "../src/codec.ts";

describe("GzipCodec", () => {
  it("round-trips strings", () => {
    const original = "hello world";
    const encoded = GzipCodec.encode(original);
    const decoded = GzipCodec.decode(encoded);
    expect(decoded).toBe(original);
  });

  it("shrinks repetitive strings", () => {
    const original = "a".repeat(1000);
    const encoded = GzipCodec.encode(original) as Uint8Array;
    expect(encoded.length).toBeLessThan(original.length);
    const decoded = GzipCodec.decode(encoded);
    expect(decoded).toBe(original);
  });

  it("passes through non-strings", () => {
    const value = 123;
    expect(GzipCodec.encode(value)).toBe(value);
    expect(GzipCodec.decode(value)).toBe(value);
  });
});

describe("JsonCodec", () => {
  it("round-trips objects", () => {
    const original = { foo: "bar", num: 42 };
    const encoded = JsonCodec.encode(original);
    expect(typeof encoded).toBe("string");
    const decoded = JsonCodec.decode(encoded);
    expect(decoded).toEqual(original);
  });

  it("returns null for null/undefined", () => {
    expect(JsonCodec.encode(null)).toBeNull();
    expect(JsonCodec.encode(undefined)).toBeNull();
  });

  it("passes through non-strings during decode", () => {
    const value = 123;
    expect(JsonCodec.decode(value)).toBe(value);
  });

  it("returns raw string on invalid JSON during decode", () => {
    const value = "not json";
    expect(JsonCodec.decode(value)).toBe(value);
  });
});
