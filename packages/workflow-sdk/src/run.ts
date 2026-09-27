/**
 * `RunHandle`: one run as returned by `fa.workflows.run()` (API.md §8.2) — its events as a
 * resumable stream, the text a node streamed, waiting for the end, the output and cancel.
 */
import {
  TERMINAL_EVENT_TYPES,
  type JsonValue,
  type RunEvent,
  type RunEventOf,
} from "@flowaid/workflow-core";
import type { Transport } from "./http.js";
import {
  streamRunEvents,
  type StreamEnd,
  type StreamOptions,
  type StreamRuntime,
} from "./stream.js";
import {
  TERMINAL_RUN_STATUSES,
  type Page,
  type Run,
  type RunAccepted,
  type RunCompleted,
  type RunStatus,
} from "./types.js";

export class RunHandle {
  readonly id: string;
  /** The status the start call answered with. */
  readonly initialStatus: RunStatus;
  /** How the most recent stream ended (`END`), once it has. */
  lastEnd: StreamEnd | undefined;

  constructor(
    private readonly transport: Transport,
    readonly accepted: RunAccepted | RunCompleted | { run_id: string; status: RunStatus },
    private readonly runtime?: StreamRuntime,
  ) {
    this.id = accepted.run_id;
    this.initialStatus = accepted.status;
  }

  /** The open human task, when the start call answered `waiting_for_human`. */
  get humanTask(): { id: string; url: string } | undefined {
    return "human_task" in this.accepted ? this.accepted.human_task : undefined;
  }

  /** Events of the run (replayed from the start, then live), typed by `RunEventSchema`. */
  stream(o: StreamOptions = {}): AsyncIterable<RunEvent> {
    return streamRunEvents(this.transport, this.id, o, (end) => (this.lastEnd = end), this.runtime);
  }

  /**
   * The text node `nodeId` streams, as it arrives (`GENERATION_DELTA`s on the `text` channel).
   * Deltas are matched by node id, or by the node run ids its `NODE_STARTED` events announce;
   * a delta that repeats already-seen characters (by `index`) is trimmed.
   */
  async *text(nodeId: string, o: Omit<StreamOptions, "deltas"> = {}): AsyncGenerator<string> {
    const nodeRuns = new Set<string>();
    const seen = new Map<string, number>();
    for await (const ev of this.stream({ ...o, deltas: true })) {
      if (ev.type === "NODE_STARTED" && ev.nodeId === nodeId) nodeRuns.add(ev.nodeRunId);
      if (ev.type !== "GENERATION_DELTA" || ev.channel !== "text") continue;
      const delta = ev as RunEventOf<"GENERATION_DELTA"> & { nodeId?: string; index?: number };
      if (delta.nodeId !== nodeId && !nodeRuns.has(delta.nodeRunId)) continue;
      let text = delta.delta;
      if (typeof delta.index === "number") {
        const have = seen.get(delta.nodeRunId) ?? 0;
        if (delta.index < have) text = text.slice(have - delta.index);
        seen.set(delta.nodeRunId, Math.max(have, delta.index + delta.delta.length));
      }
      if (text) yield text;
    }
  }

  /** Waits until the run ends (or, with `until: 'suspend'`, waits for a person) and returns it. */
  async wait(o: { signal?: AbortSignal; until?: "terminal" | "suspend" } = {}): Promise<Run> {
    if (TERMINAL_RUN_STATUSES.has(this.initialStatus)) return this.get();
    const current = await this.get({ signal: o.signal });
    if (TERMINAL_RUN_STATUSES.has(current.status)) return current;
    if (o.until === "suspend" && current.status === "waiting_for_human") return current;
    const types = [...TERMINAL_EVENT_TYPES, ...(o.until === "suspend" ? ["RUN_WAITING"] : [])];
    for await (const ev of this.stream({
      types: types as RunEvent["type"][],
      deltas: false,
      until: o.until ?? "terminal",
      after: Math.max(0, current.lastSeq),
      ...(o.signal ? { signal: o.signal } : {}),
    })) {
      void ev; // the stream ends at END; the run record is the result
    }
    return this.get({ signal: o.signal });
  }

  get(o: { signal?: AbortSignal | undefined } = {}): Promise<Run> {
    return this.transport.request<Run>("GET", `/v1/runs/${this.id}`, { signal: o.signal });
  }

  output(): Promise<{ output: JsonValue | null; outcome: string | null }> {
    return this.transport.request("GET", `/v1/runs/${this.id}/output`);
  }

  /** Durable events from the log (paged by `seq`), without streaming. */
  events(o: { after?: number; limit?: number } = {}): Promise<Page<RunEvent>> {
    return this.transport.request("GET", `/v1/runs/${this.id}/events`, { query: o });
  }

  cancel(reason?: string): Promise<{ run_id: string; status: string }> {
    return this.transport.request("POST", `/v1/runs/${this.id}/cancel`, {
      body: reason ? { reason } : {},
    });
  }
}
