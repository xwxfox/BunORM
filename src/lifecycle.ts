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

export class LifecycleManager {
  private startHooks: LifecycleHook[] = [];
  private readyHooks: LifecycleHook[] = [];
  private shutdownHooks: LifecycleHook[] = [];
  private exitHooks: LifecycleHook[] = [];

  private _ready = false;
  private _shutdown = false;

  get isReady() { return this._ready; }
  get isShutdown() { return this._shutdown; }

  onStart(hook: LifecycleHook) { this.startHooks.push(hook); }
  onReady(hook: LifecycleHook) { this.readyHooks.push(hook); }
  onShutdown(hook: LifecycleHook) { this.shutdownHooks.push(hook); }
  onExit(hook: LifecycleHook) { this.exitHooks.push(hook); }

  async runStart(ctx: ORMContext): Promise<void> {
    for (const h of this.startHooks) {
      await h(ctx);
    }
  }

  async runReady(ctx: ORMContext): Promise<void> {
    for (const h of this.readyHooks) {
      await h(ctx);
    }
    this._ready = true;
  }

  async runShutdown(ctx: ORMContext): Promise<void> {
    if (this._shutdown) return;
    this._shutdown = true;
    for (const h of this.shutdownHooks) {
      await h(ctx);
    }
  }

  async runExit(ctx: ORMContext): Promise<void> {
    for (const h of this.exitHooks) {
      await h(ctx);
    }
  }
}
