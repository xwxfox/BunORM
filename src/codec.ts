export interface ColumnCodec {
  encode(value: unknown): unknown;
  decode(value: unknown): unknown;
}

export const GzipCodec: ColumnCodec = {
  encode(value) {
    if (typeof value !== "string") return value;
    return Bun.gzipSync(new TextEncoder().encode(value));
  },
  decode(value) {
    if (!(value instanceof Uint8Array)) return value;
    return new TextDecoder().decode(Bun.gunzipSync(new Uint8Array(value)));
  },
};

export const JsonCodec: ColumnCodec = {
  encode(value) {
    if (value === undefined || value === null) return null;
    return JSON.stringify(value);
  },
  decode(value) {
    if (typeof value !== "string") return value;
    try { return JSON.parse(value); } catch { return value; }
  },
};
