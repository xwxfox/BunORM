/**
 * foxdb/src/typed-relation.ts
 * Runtime + compile-time representation of a single relation.
 * @category Relations
 */

export interface TypedRelation<
  O extends string = string,
  F extends string = string,
  T extends string = string,
  TF extends string = string,
  K extends "scalar" | "subTable" = "scalar" | "subTable",
  A extends string | undefined = string | undefined
> {
  ownerTable: O;
  ownerField: F;
  targetTable: T;
  targetField: TF;
  kind: K;
  as: A;
}
