import { type TableMeta } from "./schema.ts";

export interface TimestampConfig {
  createdAt?: string;
  updatedAt?: string;
}

export const DEFAULT_TIMESTAMP_NAMES: Required<Pick<TimestampConfig, "createdAt" | "updatedAt">> = {
  createdAt: "createdAt",
  updatedAt: "updatedAt",
};

export function resolveTimestampNames(
  config: boolean | TimestampConfig | undefined,
  meta: TableMeta
): { createdAt: string | null; updatedAt: string | null } {
  if (!config) {
    return { createdAt: null, updatedAt: null };
  }

  const createdAtName: string =
    typeof config === "object" && config.createdAt !== undefined
      ? config.createdAt
      : DEFAULT_TIMESTAMP_NAMES.createdAt;

  const updatedAtName: string =
    typeof config === "object" && config.updatedAt !== undefined
      ? config.updatedAt
      : DEFAULT_TIMESTAMP_NAMES.updatedAt;

  const columnNames = new Set(meta.columns.map((c) => c.name));

  return {
    createdAt: columnNames.has(createdAtName) ? null : createdAtName,
    updatedAt: columnNames.has(updatedAtName) ? null : updatedAtName,
  };
}
