import { describe, test, expect } from "bun:test";
import { ORMError, raise, withTrace, handleError } from "../src/errors.ts";

describe("ORMError", () => {
  test("captures trace context", () => {
    try {
      withTrace("repository.insert", { table: "users" }, () => {
        raise("VALIDATION_FAILED", "email is required", { field: "email" });
      });
    } catch (e) {
      expect(e).toBeInstanceOf(ORMError);
      const err = e as ORMError;
      expect(err.code).toBe("VALIDATION_FAILED");
      expect(err.trace.length).toBeGreaterThan(0);
      expect(err.context.field).toBe("email");
    }
  });

  test("plain Error falls through raise", () => {
    expect(() => raise("PLAIN", "boom")).toThrow("boom");
  });
});

describe("Error policy", () => {
  test("throw policy re-throws", () => {
    expect(() =>
      handleError(new ORMError("bad", { code: "X", trace: [] }), "throw")
    ).toThrow("bad");
  });

  test("emit-swallow returns without throwing", () => {
    let threw = false;
    try {
      handleError(new ORMError("bad", { code: "X", trace: [] }), "emit-swallow");
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);
  });

  test("raise produces ORMError with trace", () => {
    try {
      withTrace("test", {}, () => {
        raise("TEST_ERROR", "something went wrong", { table: "users" });
      });
    } catch (e) {
      expect(e).toBeInstanceOf(ORMError);
      const err = e as ORMError;
      expect(err.code).toBe("TEST_ERROR");
      expect(err.trace.length).toBeGreaterThan(0);
      expect(err.context.table).toBe("users");
    }
  });
});
