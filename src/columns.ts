/**
 * bunorm/src/columns.ts
 * Builds a typed proxy from a TypeBox TObject so that schema.sku returns
 * a ColumnRef whose type encodes the exact column name.
 */

import type { TObject, TString, TNumber, TInteger, TBoolean, TLiteral } from "typebox";

export type TScalarSchema =
  | TString
  | TNumber
  | TInteger
  | TBoolean
  | TLiteral<string>
  | TLiteral<number>
  | TLiteral<boolean>;

/** Runtime marker + compile-time name carrier */
export interface ColumnRef<N extends string = string, S extends TScalarSchema = TScalarSchema> {
  readonly _tag: "ColumnRef";
  readonly name: N;
  readonly schema: S;
}

/** Turn a TObject's scalar properties into ColumnRefs */
export type ColumnRefs<T extends TObject> = {
  readonly [K in keyof T["properties"] as T["properties"][K] extends TScalarSchema
    ? K
    : never]: T["properties"][K] extends TScalarSchema
    ? ColumnRef<K & string, T["properties"][K]>
    : never;
};

/** Build the runtime proxy object */
export function createColumnProxy<T extends TObject>(schema: T): ColumnRefs<T> {
  const proxy = {} as Record<string, ColumnRef<string, TScalarSchema>>;
  for (const key of Object.keys(schema.properties)) {
    const prop = schema.properties[key];
    if (prop && typeof prop === "object" && !("items" in prop)) {
      proxy[key] = { _tag: "ColumnRef", name: key, schema: prop as TScalarSchema };
    }
  }
  return proxy as ColumnRefs<T>;
}
