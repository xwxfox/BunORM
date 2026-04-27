/**
 * src/lifecycle.ts
 * Orchestrates startup and shutdown sequences.
 * Hooks execute synchronously in order. If a hook returns a Promise,
 * it fires in the background (errors are logged to stderr).
 */

import type { BunDatabase } from "./database.ts";
import type { MetaStore } from "./meta.ts";
import type { BunORM, CreateORMOptions } from "./orm.ts";

export interface ORMContext<
  T extends Record<string, any> = Record<string, any>,
  Rels extends readonly any[] = any
> {
  /** Public ORM accessor */
  orm: BunORM<T, Rels>;
  /** Raw DB wrapper */
  db: BunDatabase;
  /** Metadata store */
  meta: MetaStore;
  /** Known table names */
  tables: string[];
  /** Internal repository map for advanced use */
  repos: Map<string, any>;
  /** Logger proxy (debug mode) */
  logger: { log: (...args: unknown[]) => void; error: (...args: unknown[]) => void };
}

export type LifecycleHook<
  T extends Record<string, any> = Record<string, any>,
  Rels extends readonly any[] = any
> = (ctx: ORMContext<T, Rels>) => void | Promise<void>;

function runSyncOrLog<
  T extends Record<string, any> = Record<string, any>,
  Rels extends readonly any[] = any
>(
  hooks: LifecycleHook<T, Rels>[],
  ctx: ORMContext<T, Rels>,
  label: string
): void {
  for (const h of hooks) {
    try {
      const result = h(ctx);
      if (result && typeof (result as Promise<void>).then === "function") {
        (result as Promise<void>).catch((err: unknown) => {
          console.error(`[bunorm] async ${label} hook error:`, err);
        });
      }
    } catch (err) {
      console.error(`[bunorm] ${label} hook error:`, err);
    }
  }
}

export class LifecycleManager<
  T extends Record<string, any> = Record<string, any>,
  Rels extends readonly any[] = any
> {
  private startHooks: LifecycleHook<T, Rels>[] = [];
  private readyHooks: LifecycleHook<T, Rels>[] = [];
  private shutdownHooks: LifecycleHook<T, Rels>[] = [];
  private exitHooks: LifecycleHook<T, Rels>[] = [];

  private _ready = false;
  private _shutdown = false;

  get isReady() { return this._ready; }
  get isShutdown() { return this._shutdown; }

  onStart(hook: LifecycleHook<T, Rels>) { this.startHooks.push(hook); }
  onReady(hook: LifecycleHook<T, Rels>) { this.readyHooks.push(hook); }
  onShutdown(hook: LifecycleHook<T, Rels>) { this.shutdownHooks.push(hook); }
  onExit(hook: LifecycleHook<T, Rels>) { this.exitHooks.push(hook); }

  runStart(ctx: ORMContext<T, Rels>): void {
    runSyncOrLog(this.startHooks, ctx, "onStart");
  }

  runReady(ctx: ORMContext<T, Rels>): void {
    runSyncOrLog(this.readyHooks, ctx, "onReady");
    this._ready = true;
  }

  runShutdown(ctx: ORMContext<T, Rels>): void {
    if (this._shutdown) return;
    this._shutdown = true;
    runSyncOrLog(this.shutdownHooks, ctx, "onShutdown");
  }

  runExit(ctx: ORMContext<T, Rels>): void {
    runSyncOrLog(this.exitHooks, ctx, "onExit");
  }
}
