import { describe, test, expect } from "bun:test";
import { ORMError, raise, withTrace } from "../src/errors.ts";

describe("ORMError", () => {
  test("captures trace context", () => {
    try {
      withTrace("repository.insert", { table: "users" }, () => {
        raise("VALIDATION_FAILED", "email is required", { field: "email" });
      });
    } catch (e) {
      expect(e).toBeInstanceOf(ORMError);
      expect(e.code).toBe("VALIDATION_FAILED");
      expect(e.trace.length).toBeGreaterThan(0);
      expect(e.context.field).toBe("email");
    }
  });

  test("plain Error falls through raise", () => {
    expect(() => raise("PLAIN", "boom")).toThrow("boom");
  });
});
