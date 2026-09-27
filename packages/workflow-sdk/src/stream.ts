/**
 * The run event stream (API.md §5, §8.2) over `fetch` + `ReadableStream` + `eventsource-parser`
 * — never the browser `EventSource`, which cannot send `Authorization`. Durable events carry
 * `id: <seq>`; after a dropped connection the stream reconnects with `Last-Event-ID` so no
 * durable event is lost or repeated. Reconnects back off exponentially (1 s → 30 s, full
 * jitter) and give up after 5 consecutive failures ({@link StreamDisconnectedError}); a resume
 * position the server no longer retains is {@link StreamExpiredError}. The stream ends at the
 * server's `END` event.
 */
import { createParser, type EventSourceMessage } from "eventsource-parser";
import type { RunEvent, RunEventType } from "@flowaid/workflow-core";
import { FlowaidApiError, StreamDisconnectedError, StreamExpiredError } from "./errors.js";
import type { Transport } from "./http.js";

export interface StreamOptions {
  /** Only these durable event types (ephemeral deltas and logs are governed by `deltas`/`logs`). */
  types?: readonly RunEventType[];
  /** `GENERATION_DELTA`s (default true). */
  deltas?: boolean;
  /** `LOG` events (default false). */
  logs?: boolean;
  /** `terminal` (default): end after the run ends; `suspend`: also after the first `RUN_WAITING`; `never`: stay open. */
  until?: "terminal" | "suspend" | "never";
  /** Resume after this durable `seq` (default 0: from the start). */
  after?: number;
  signal?: AbortSignal;
  /** Consecutive failed attempts before giving up (default 5). */
  maxAttempts?: number;
  /** Backoff bounds in ms (default 1000 → 30000). */
  backoff?: { baseMs?: number; maxMs?: number };
}

/** What `END` reported, once the stream has ended. */
export interface StreamEnd {
  run_id: string;
  final_status?: string;
  reason?: string;
}

/** Test seams: the delay and randomness of the backoff. */
export interface StreamRuntime {
  sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  random: () => number;
}

const defaultRuntime: StreamRuntime = {
  sleep: (ms, signal) =>
    new Promise((resolve, reject) => {
      if (signal?.aborted) return reject(signal.reason as Error);
      const t = setTimeout(() => {
        signal?.removeEventListener("abort", onAbort);
        resolve();
      }, ms);
      const onAbort = () => {
        clearTimeout(t);
        reject(signal?.reason as Error);
      };
      signal?.addEventListener("abort", onAbort, { once: true });
    }),
  random: Math.random,
};

/** Full-jitter exponential backoff for the n-th consecutive failure (n ≥ 1). */
export function backoffDelay(
  attempt: number,
  random: () => number,
  baseMs = 1000,
  maxMs = 30_000,
): number {
  return Math.floor(random() * Math.min(maxMs, baseMs * 2 ** (attempt - 1)));
}

/** Parses a byte stream of SSE into messages. */
export async function* sseMessages(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): AsyncGenerator<EventSourceMessage | { retry: number }> {
  const queue: (EventSourceMessage | { retry: number })[] = [];
  const parser = createParser({
    onEvent: (m) => queue.push(m),
    onRetry: (retry) => queue.push({ retry }),
  });
  const reader = body.pipeThrough(new TextDecoderStream()).getReader();
  const cancel = () => void reader.cancel().catch(() => undefined);
  signal?.addEventListener("abort", cancel, { once: true });
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      parser.feed(value);
      while (queue.length) yield queue.shift() as EventSourceMessage | { retry: number };
    }
  } finally {
    signal?.removeEventListener("abort", cancel);
    cancel();
  }
}

/** A `StreamEnd` receiver, so callers can learn how the stream ended. */
export type OnEnd = (end: StreamEnd) => void;

export async function* streamRunEvents(
  transport: Transport,
  runId: string,
  o: StreamOptions = {},
  onEnd?: OnEnd,
  runtime: StreamRuntime = defaultRuntime,
): AsyncGenerator<RunEvent> {
  const maxAttempts = o.maxAttempts ?? 5;
  const include = [
    ...((o.deltas ?? true) ? ["deltas"] : []),
    ...((o.logs ?? false) ? ["logs"] : []),
  ];
  let lastId = o.after ?? 0;
  let failures = 0;
  for (;;) {
    if (o.signal?.aborted) return;
    let failure: unknown;
    try {
      const res = await transport.raw("GET", `/v1/runs/${encodeURIComponent(runId)}/stream`, {
        query: {
          until: o.until ?? "terminal",
          include: include.length ? include.join(",") : "none",
          ...(o.types?.length ? { types: o.types.join(",") } : {}),
        },
        headers: {
          accept: "text/event-stream",
          ...(lastId > 0 ? { "last-event-id": String(lastId) } : {}),
        },
        signal: o.signal,
      });
      if (!res.body) throw new Error("the stream response has no body");
      for await (const m of sseMessages(res.body, o.signal)) {
        failures = 0;
        if ("retry" in m) continue;
        if (m.event === "END") {
          onEnd?.(JSON.parse(m.data) as StreamEnd);
          return;
        }
        if (m.id) lastId = Number(m.id);
        yield JSON.parse(m.data) as RunEvent;
      }
      if (o.signal?.aborted) return;
      failure = new Error("the stream closed before END");
    } catch (error) {
      if (o.signal?.aborted) return;
      if (error instanceof FlowaidApiError) {
        if (error.expired) throw new StreamExpiredError(runId, lastId);
        if (!error.retryable) throw error;
      }
      failure = error;
    }
    failures += 1;
    if (failures >= maxAttempts)
      throw new StreamDisconnectedError(runId, failures, { cause: failure });
    try {
      await runtime.sleep(
        backoffDelay(failures, runtime.random, o.backoff?.baseMs, o.backoff?.maxMs),
        o.signal,
      );
    } catch {
      return; // aborted while waiting
    }
  }
}
