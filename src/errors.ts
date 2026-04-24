/**
 * src/errors.ts
 * Central error type with invisible tracing and structured context.
 */

export interface TraceEntry {
  label: string;
  time: number;
  details?: Record<string, unknown>;
}

export interface ORMErrorContext {
  table?: string;
  operation?: string;
  sql?: string;
  params?: unknown[];
  schema?: unknown;
  [key: string]: unknown;
}

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

// Simple synchronous trace stack — safe because SQLite ops are single-threaded
const _traceStack: TraceEntry[] = [];

export function enterTrace(label: string, details?: Record<string, unknown>): void {
  _traceStack.push({ label, time: Date.now(), details });
}

export function leaveTrace(): void {
  _traceStack.pop();
}

export function currentTrace(): TraceEntry[] {
  return _traceStack.slice();
}

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

/**
 * Primary throw helper used across the ORM.
 * Always throws an ORMError with full trace + context.
 */
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
