export type SweepTask = () => void;

export class TableScheduler {
  private timers = new Set<ReturnType<typeof setInterval>>();
  private timersByName = new Map<string, ReturnType<typeof setInterval>>();
  private tasks = new Map<string, SweepTask>();

  schedule(name: string, intervalMs: number, task: SweepTask): void {
    this.clear(name);
    this.tasks.set(name, task);
    const timer = setInterval(() => {
      try { task(); } catch (err) { console.error(`[foxdb] scheduler task "${name}" failed:`, err); }
    }, intervalMs);
    this.timers.add(timer);
    this.timersByName.set(name, timer);
  }

  clear(name: string): void {
    const timer = this.timersByName.get(name);
    if (timer) {
      clearInterval(timer);
      this.timers.delete(timer);
      this.timersByName.delete(name);
    }
    this.tasks.delete(name);
  }

  clearAll(): void {
    for (const t of this.timers) clearInterval(t);
    this.timers.clear();
    this.timersByName.clear();
    this.tasks.clear();
  }
}
