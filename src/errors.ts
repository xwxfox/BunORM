/**
 * src/errors.ts
 * Central error type with invisible tracing and structured context.
 */

/** a single entry in the error trace */
export interface TraceEntry {
  label: string;
  time: number;
  details?: Record<string, unknown>;
}

/** context captured when an error occurs */
export interface ORMErrorContext {
  table?: string;
  operation?: string;
  sql?: string;
  params?: unknown[];
  schema?: unknown;
  [key: string]: unknown;
}

/** structured error with trace and context */
export class ORMError extends Error {
  readonly code: string;
  readonly trace: TraceEntry[];
  readonly context: ORMErrorContext;

  constructor(
    message: string,
    opts: {
      code: string;
      trace: TraceEntry[];
      context?: ORMErrorContext;
    }
  ) {
    super(message);
    this.name = "ORMError";
    this.code = opts.code;
    this.trace = opts.trace;
    this.context = opts.context ?? {};
  }
}

// Simple synchronous trace stack - safe because SQLite ops are single-threaded
const _traceStack: TraceEntry[] = [];

/** @internal */
export function enterTrace(label: string, details?: Record<string, unknown>): void {
  _traceStack.push({ label, time: Date.now(), details });
}

/** @internal */
export function leaveTrace(): void {
  _traceStack.pop();
}

/** @internal */
export function currentTrace(): TraceEntry[] {
  return _traceStack.slice();
}

/** @internal */
export function withTrace<T>(
  label: string,
  details: Record<string, unknown> | undefined,
  fn: () => T
): T {
  enterTrace(label, details);
  try {
    return fn();
  } finally {
    leaveTrace();
  }
}

/** throw an ORMError with trace and context */
export function raise(
  code: string,
  message: string,
  context?: ORMErrorContext
): never {
  throw new ORMError(message, {
    code,
    trace: currentTrace(),
    context,
  });
}

/** how to handle runtime errors */
export type ErrorPolicy = "throw" | "emit" | "emit-swallow" | "crash";

/** @internal */
export function handleError(
  err: ORMError,
  policy: ErrorPolicy,
  emit?: (event: string, payload: unknown) => void
): never | void {
  if (emit) {
    emit("error", { phase: "error", error: err, timestamp: Date.now() });
  }

  switch (policy) {
    case "emit-swallow":
      return;
    case "crash":
      console.error("[foxdb] fatal error - crashing", err);
      process.exit(1);
    case "emit":
    case "throw":
    default:
      throw err;
  }
}
