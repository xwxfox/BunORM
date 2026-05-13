import type { DBBinary, DBValue } from "./types";

export interface ColumnCodec {
  encode(value: DBValue | undefined): DBValue | DBBinary;
  decode(value: DBValue | DBBinary): DBValue;
}

export const GzipCodec: ColumnCodec = {
  encode(value: DBValue): DBValue | DBBinary {
    if (typeof value !== "string") return value;
    const bytes = new TextEncoder().encode(value);
    return Bun.gzipSync(bytes.buffer as ArrayBuffer);
  },
  decode(value: DBValue | DBBinary): DBValue {
    if (!(value instanceof Uint8Array)) return value;
    return new TextDecoder().decode(Bun.gunzipSync(value.buffer as ArrayBuffer));
  },
};

export const JsonCodec: ColumnCodec = {
  encode(value: unknown): DBValue | DBBinary {
    if (value === undefined || value === null) return null;
    return JSON.stringify(value);
  },
  decode(value: DBValue | DBBinary): DBValue {
    if (typeof value !== "string") return value;
    try { return JSON.parse(value); } catch { return value; }
  },
};