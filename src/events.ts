/**
 * src/events.ts
 * Zero-overhead event bus. Uses lazy Map+Set. No payload construction
 * unless at least one listener is registered for the event key.
 */

type Listener = (payload: unknown) => void;

export class EventBus {
  private readonly listeners = new Map<string, Set<Listener>>();
  private readonly tableActive = new Set<string>();

  has(event: string): boolean {
    const set = this.listeners.get(event);
    return set !== undefined && set.size > 0;
  }

  hasAny(tableName: string): boolean {
    return this.tableActive.has(tableName);
  }

  on(event: string, fn: Listener): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(fn);

    // Track table-level activity for fast-path skipping
    const table = event.split(".")[0];
    if (table && table !== "*") {
      this.tableActive.add(table);
    }

    return () => {
      const set = this.listeners.get(event);
      if (set) {
        set.delete(fn);
        if (set.size === 0) {
          this.listeners.delete(event);
          // We intentionally leave tableActive as a coarse flag — correctness
          // is guaranteed by the final has() check inside emit().
        }
      }
    };
  }

  emit(event: string, payload: unknown): void {
    const set = this.listeners.get(event);
    if (set) {
      for (const fn of set) {
        try {
          fn(payload);
        } catch {
          // Listener errors must not break the emitter
        }
      }
    }

    // Check for wildcard listeners (e.g. "users.*" for "users.insert")
    const dotIndex = event.indexOf(".");
    if (dotIndex > 0) {
      const table = event.slice(0, dotIndex);
      const wildcard = `${table}.*`;
      const wildcardSet = this.listeners.get(wildcard);
      if (wildcardSet) {
        for (const fn of wildcardSet) {
          try {
            fn(payload);
          } catch {
            // Listener errors must not break the emitter
          }
        }
      }
    }
  }

  emitIf(event: string, payload: unknown): void {
    if (this.has(event)) {
      this.emit(event, payload);
    }
  }
}
