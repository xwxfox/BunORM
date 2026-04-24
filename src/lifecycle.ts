/**
 * src/lifecycle.ts
 * Orchestrates startup and shutdown sequences.
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

export type LifecycleHook<T extends Record<string, any> = Record<string, any>, Rels extends readonly any[] = any> =
  | ((ctx: ORMContext<T, Rels>) => void)
  | ((ctx: ORMContext<T, Rels>) => Promise<void>);

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

  async runStart(ctx: ORMContext<T, Rels>): Promise<void> {
    for (const h of this.startHooks) {
      await h(ctx);
    }
  }

  async runReady(ctx: ORMContext<T, Rels>): Promise<void> {
    for (const h of this.readyHooks) {
      await h(ctx);
    }
    this._ready = true;
  }

  async runShutdown(ctx: ORMContext<T, Rels>): Promise<void> {
    if (this._shutdown) return;
    this._shutdown = true;
    for (const h of this.shutdownHooks) {
      await h(ctx);
    }
  }

  async runExit(ctx: ORMContext<T, Rels>): Promise<void> {
    for (const h of this.exitHooks) {
      await h(ctx);
    }
  }
}
