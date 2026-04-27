/**
 * bunorm/src/columns.ts
 * Builds a typed proxy from a TypeBox TObject so that schema.sku returns
 * a ColumnRef whose type encodes the exact column name.
 */

import {
  IsString,
  IsNumber,
  IsInteger,
  IsBoolean,
  IsLiteral,
  type TObject,
  type TString,
  type TNumber,
  type TInteger,
  type TBoolean,
  type TLiteral,
  type TSchema,
} from "typebox";

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

/** Runtime type-guard: determines if a schema property is a scalar */
function isScalarSchema(prop: TSchema): prop is TScalarSchema {
  return (
    IsString(prop) ||
    IsNumber(prop) ||
    IsInteger(prop) ||
    IsBoolean(prop) ||
    IsLiteral(prop)
  );
}

/** Build the runtime proxy object */
export function createColumnProxy<T extends TObject>(schema: T): ColumnRefs<T> {
  const proxy: Record<string, ColumnRef<string, TScalarSchema>> = {};
  for (const key of Object.keys(schema.properties)) {
    const prop = schema.properties[key];
    if (prop && isScalarSchema(prop)) {
      proxy[key] = { _tag: "ColumnRef", name: key, schema: prop };
    }
  }
  return proxy as ColumnRefs<T>;
}
