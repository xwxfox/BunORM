export interface ColumnCodec {
  encode(value: unknown): unknown;
  decode(value: unknown): unknown;
}

export const GzipCodec: ColumnCodec = {
  encode(value: unknown): unknown {
    if (typeof value !== "string") return value;
    const bytes = new TextEncoder().encode(value);
    return Bun.gzipSync(bytes.buffer as ArrayBuffer);
  },
  decode(value: unknown): unknown {
    if (!(value instanceof Uint8Array)) return value;
    return new TextDecoder().decode(Bun.gunzipSync(value.buffer as ArrayBuffer));
  },
};

export const JsonCodec: ColumnCodec = {
  encode(value: unknown): unknown {
    if (value === undefined || value === null) return null;
    return JSON.stringify(value);
  },
  decode(value: unknown): unknown {
    if (typeof value !== "string") return value;
    try { return JSON.parse(value); } catch { return value; }
  },
};