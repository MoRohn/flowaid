/**
 * In-process fan-out of run notifications: one bus subscription per channel for the whole API,
 * shared by every SSE stream and sync waiter. Durable notifications carry ids only
 * (`{ runId, fromSeq, toSeq }`); listeners re-read events by seq. Ephemeral events (generation
 * deltas, logs) arrive on `run_deltas` with the event itself.
 *
 * Commit notices are `pg_notify('run_events')` calls inside the append transaction, so they are
 * read from `commits` (a Postgres bus) even when `bus` is Redis pub/sub (scale mode).
 */
import { RUN_EVENTS_CHANNEL } from "@flowaid/database";
import type { EventBus, JsonValue } from "@flowaid/workflow-core";

export const RUN_DELTAS_CHANNEL = "run_deltas";

export interface RunListener {
  durable(fromSeq: number, toSeq: number): void;
  ephemeral?(event: JsonValue): void;
}

export class RunEventHub {
  private readonly listeners = new Map<string, Set<RunListener>>();
  private started: Promise<void> | null = null;
  private unsubs: (() => Promise<void>)[] = [];

  constructor(
    private readonly bus: EventBus,
    private readonly commits: EventBus = bus,
  ) {}

  private start(): Promise<void> {
    this.started ??= (async () => {
      this.unsubs.push(
        await this.commits.subscribe(RUN_EVENTS_CHANNEL, (m) => {
          const msg = m as { runId?: string; fromSeq?: number; toSeq?: number };
          if (typeof msg.runId !== "string") return;
          for (const l of this.listeners.get(msg.runId) ?? [])
            l.durable(msg.fromSeq ?? 0, msg.toSeq ?? 0);
        }),
      );
      this.unsubs.push(
        await this.bus.subscribe(RUN_DELTAS_CHANNEL, (m) => {
          const msg = m as { runId?: string; event?: JsonValue };
          if (typeof msg.runId !== "string" || msg.event === undefined) return;
          for (const l of this.listeners.get(msg.runId) ?? []) l.ephemeral?.(msg.event);
        }),
      );
    })();
    return this.started;
  }

  async listen(runId: string, listener: RunListener): Promise<() => void> {
    await this.start();
    let set = this.listeners.get(runId);
    if (!set) this.listeners.set(runId, (set = new Set()));
    set.add(listener);
    return () => {
      set.delete(listener);
      if (set.size === 0) this.listeners.delete(runId);
    };
  }

  get size(): number {
    let n = 0;
    for (const s of this.listeners.values()) n += s.size;
    return n;
  }

  async close(): Promise<void> {
    await Promise.all(this.unsubs.map((u) => u().catch(() => undefined)));
    this.unsubs = [];
    this.started = null;
    this.listeners.clear();
  }
}
