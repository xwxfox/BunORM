/**
 * foxdb/tests/diff.test.ts
 * Tests for the schema diff engine.
 */

import { describe, test, expect } from "bun:test";
import { computeDiff, type DesiredTable } from "../src/diff.ts";
import type { InspectorTable } from "../src/inspector.ts";

function desired(name: string, columns: DesiredTable["columns"], opts?: { indexes?: DesiredTable["indexes"]; pk?: string }): DesiredTable {
  return {
    name,
    columns,
    indexes: opts?.indexes ?? [],
    primaryKey: opts?.pk ?? "id",
  };
}

function actual(name: string, columns: InspectorTable["columns"], indexes?: InspectorTable["indexes"]): InspectorTable {
  return { name, columns, indexes: indexes ?? [] };
}

describe("computeDiff", () => {
  test("empty actual - all tables are safe add", () => {
    const d: DesiredTable[] = [
      desired("users", [
        { name: "id", sqlType: "TEXT", nullable: false, optional: false },
        { name: "name", sqlType: "TEXT", nullable: false, optional: false },
      ]),
    ];
    const a: InspectorTable[] = [];

    const diff = computeDiff(d, a);
    expect(diff.safe).toHaveLength(1);
    expect(diff.safe[0]!.kind).toBe("add-table");
    expect(diff.unsafe).toHaveLength(0);
  });

  test("matching schema - no changes", () => {
    const d: DesiredTable[] = [
      desired("users", [
        { name: "id", sqlType: "TEXT", nullable: false, optional: false },
        { name: "name", sqlType: "TEXT", nullable: false, optional: false },
      ]),
    ];
    const a: InspectorTable[] = [
      actual("users", [
        { name: "id", type: "TEXT", notnull: 1, dflt_value: null, pk: 1 },
        { name: "name", type: "TEXT", notnull: 1, dflt_value: null, pk: 0 },
      ]),
    ];

    const diff = computeDiff(d, a);
    expect(diff.safe).toHaveLength(0);
    expect(diff.unsafe).toHaveLength(0);
  });

  test("missing nullable column - safe add", () => {
    const d: DesiredTable[] = [
      desired("users", [
        { name: "id", sqlType: "TEXT", nullable: false, optional: false },
        { name: "email", sqlType: "TEXT", nullable: true, optional: true },
      ]),
    ];
    const a: InspectorTable[] = [
      actual("users", [
        { name: "id", type: "TEXT", notnull: 1, dflt_value: null, pk: 1 },
      ]),
    ];

    const diff = computeDiff(d, a);
    expect(diff.safe).toHaveLength(1);
    expect(diff.safe[0]!.kind).toBe("add-column");
    expect(diff.unsafe).toHaveLength(0);
  });

  test("missing required column - unsafe add", () => {
    const d: DesiredTable[] = [
      desired("users", [
        { name: "id", sqlType: "TEXT", nullable: false, optional: false },
        { name: "email", sqlType: "TEXT", nullable: false, optional: false },
      ]),
    ];
    const a: InspectorTable[] = [
      actual("users", [
        { name: "id", type: "TEXT", notnull: 1, dflt_value: null, pk: 1 },
      ]),
    ];

    const diff = computeDiff(d, a);
    expect(diff.unsafe).toHaveLength(1);
    expect(diff.unsafe[0]!.kind).toBe("add-column");
    expect(diff.safe).toHaveLength(0);
  });

  test("type mismatch - unsafe change-type", () => {
    const d: DesiredTable[] = [
      desired("users", [
        { name: "id", sqlType: "TEXT", nullable: false, optional: false },
        { name: "age", sqlType: "INTEGER", nullable: false, optional: false },
      ]),
    ];
    const a: InspectorTable[] = [
      actual("users", [
        { name: "id", type: "TEXT", notnull: 1, dflt_value: null, pk: 1 },
        { name: "age", type: "REAL", notnull: 1, dflt_value: null, pk: 0 },
      ]),
    ];

    const diff = computeDiff(d, a);
    expect(diff.unsafe).toHaveLength(1);
    expect(diff.unsafe[0]!.kind).toBe("change-type");
  });

  test("notnull → nullable - safe change-nullable", () => {
    const d: DesiredTable[] = [
      desired("users", [
        { name: "id", sqlType: "TEXT", nullable: false, optional: false },
        { name: "bio", sqlType: "TEXT", nullable: true, optional: true },
      ]),
    ];
    const a: InspectorTable[] = [
      actual("users", [
        { name: "id", type: "TEXT", notnull: 1, dflt_value: null, pk: 1 },
        { name: "bio", type: "TEXT", notnull: 1, dflt_value: null, pk: 0 },
      ]),
    ];

    const diff = computeDiff(d, a);
    expect(diff.safe).toHaveLength(1);
    expect(diff.safe[0]!.kind).toBe("change-nullable");
    expect(diff.unsafe).toHaveLength(0);
  });

  test("nullable → notnull - unsafe change-nullable", () => {
    const d: DesiredTable[] = [
      desired("users", [
        { name: "id", sqlType: "TEXT", nullable: false, optional: false },
        { name: "bio", sqlType: "TEXT", nullable: false, optional: false },
      ]),
    ];
    const a: InspectorTable[] = [
      actual("users", [
        { name: "id", type: "TEXT", notnull: 1, dflt_value: null, pk: 1 },
        { name: "bio", type: "TEXT", notnull: 0, dflt_value: null, pk: 0 },
      ]),
    ];

    const diff = computeDiff(d, a);
    expect(diff.unsafe).toHaveLength(1);
    expect(diff.unsafe[0]!.kind).toBe("change-nullable");
    expect(diff.safe).toHaveLength(0);
  });

  test("extra column in actual - unsafe drop-column", () => {
    const d: DesiredTable[] = [
      desired("users", [
        { name: "id", sqlType: "TEXT", nullable: false, optional: false },
      ]),
    ];
    const a: InspectorTable[] = [
      actual("users", [
        { name: "id", type: "TEXT", notnull: 1, dflt_value: null, pk: 1 },
        { name: "legacy", type: "TEXT", notnull: 0, dflt_value: null, pk: 0 },
      ]),
    ];

    const diff = computeDiff(d, a);
    expect(diff.unsafe).toHaveLength(1);
    expect(diff.unsafe[0]!.kind).toBe("drop-column");
  });

  test("missing index - safe add-index", () => {
    const d: DesiredTable[] = [
      desired("users", [
        { name: "id", sqlType: "TEXT", nullable: false, optional: false },
        { name: "email", sqlType: "TEXT", nullable: false, optional: false },
      ], { indexes: [{ columns: ["email"], unique: false }] }),
    ];
    const a: InspectorTable[] = [
      actual("users", [
        { name: "id", type: "TEXT", notnull: 1, dflt_value: null, pk: 1 },
        { name: "email", type: "TEXT", notnull: 1, dflt_value: null, pk: 0 },
      ]),
    ];

    const diff = computeDiff(d, a);
    expect(diff.safe).toHaveLength(1);
    expect(diff.safe[0]!.kind).toBe("add-index");
  });

  test("pk mismatch - unsafe change-pk", () => {
    const d: DesiredTable[] = [
      desired("users", [
        { name: "id", sqlType: "TEXT", nullable: false, optional: false },
        { name: "email", sqlType: "TEXT", nullable: false, optional: false },
      ], { pk: "email" }),
    ];
    const a: InspectorTable[] = [
      actual("users", [
        { name: "id", type: "TEXT", notnull: 1, dflt_value: null, pk: 1 },
        { name: "email", type: "TEXT", notnull: 1, dflt_value: null, pk: 0 },
      ]),
    ];

    const diff = computeDiff(d, a);
    expect(diff.unsafe).toHaveLength(1);
    expect(diff.unsafe[0]!.kind).toBe("change-pk");
  });

  test("extra table in actual - unsafe drop-table", () => {
    const d: DesiredTable[] = [
      desired("users", [{ name: "id", sqlType: "TEXT", nullable: false, optional: false }]),
    ];
    const a: InspectorTable[] = [
      actual("users", [{ name: "id", type: "TEXT", notnull: 1, dflt_value: null, pk: 1 }]),
      actual("old_table", [{ name: "x", type: "TEXT", notnull: 0, dflt_value: null, pk: 0 }]),
    ];

    const diff = computeDiff(d, a);
    expect(diff.unsafe).toHaveLength(1);
    expect(diff.unsafe[0]!.kind).toBe("drop-table");
  });

  test("sub-table missing - safe add-subtable", () => {
    const d: DesiredTable[] = [
      desired("sales", [{ name: "id", sqlType: "TEXT", nullable: false, optional: false }]),
      desired("sales__lineItems", [
        { name: "itemNumber", sqlType: "TEXT", nullable: false, optional: false },
      ], { pk: "_id" }),
    ];
    const a: InspectorTable[] = [
      actual("sales", [{ name: "id", type: "TEXT", notnull: 1, dflt_value: null, pk: 1 }]),
    ];

    const diff = computeDiff(d, a);
    expect(diff.safe).toHaveLength(1);
    expect(diff.safe[0]!.kind).toBe("add-subtable");
    expect(diff.unsafe).toHaveLength(0);
  });

  test("internal columns are ignored in actual", () => {
    const d: DesiredTable[] = [
      desired("sales__lineItems", [
        { name: "itemNumber", sqlType: "TEXT", nullable: false, optional: false },
      ], { pk: "_id" }),
    ];
    const a: InspectorTable[] = [
      actual("sales__lineItems", [
        { name: "_id", type: "INTEGER", notnull: 1, dflt_value: null, pk: 1 },
        { name: "_owner_id", type: "TEXT", notnull: 1, dflt_value: null, pk: 0 },
        { name: "_index", type: "INTEGER", notnull: 1, dflt_value: null, pk: 0 },
        { name: "itemNumber", type: "TEXT", notnull: 1, dflt_value: null, pk: 0 },
      ]),
    ];

    const diff = computeDiff(d, a);
    expect(diff.safe).toHaveLength(0);
    expect(diff.unsafe).toHaveLength(0);
  });
});
