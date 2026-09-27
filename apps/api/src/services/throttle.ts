/** Fixed-window counters for login throttling (in process; the rate-limit plugin covers the rest). */
export class Throttle {
  private readonly windows = new Map<string, { count: number; resetAt: number }>();
  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number,
  ) {}
  /** Counts a hit; false when the key is over its limit for the current window. */
  hit(key: string): boolean {
    const t = this.now();
    const w = this.windows.get(key);
    if (!w || w.resetAt <= t) {
      if (this.windows.size > 50_000) this.windows.clear();
      this.windows.set(key, { count: 1, resetAt: t + this.windowMs });
      return true;
    }
    w.count++;
    return w.count <= this.limit;
  }
  reset(key: string): void {
    this.windows.delete(key);
  }
}
