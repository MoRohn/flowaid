/**
 * Run event streaming over `GET /v1/runs/:id/stream` (API.md §5, §5.1) with `fetch` instead of
 * `EventSource`, so requests carry the workspace header and `Last-Event-ID` on every reconnect.
 * Framework-free: the React hook in `useRunStream.ts` wraps it, and tests drive it with a fake fetch.
 *
 * Reconnects follow §5.1: 1 s → 30 s exponential backoff with jitter, at most 5 attempts in a
 * row; a successful connect resets the count. Resuming after a drop reports `resumed: true`
 * because ephemeral `GENERATION_DELTA`s sent while disconnected are not replayed.
 */

export interface SseMessage {
  id?: string;
  event: string;
  data: string;
}

/** Incremental `text/event-stream` parser: feed decoded chunks, get whole messages. */
export function createSseParser(onMessage: (m: SseMessage) => void) {
  let buffer = "";
  let id: string | undefined;
  let event = "";
  let data: string[] = [];
  const dispatch = () => {
    if (data.length > 0 || event) {
      onMessage({
        ...(id !== undefined ? { id } : {}),
        event: event || "message",
        data: data.join("\n"),
      });
    }
    id = undefined;
    event = "";
    data = [];
  };
  const line = (l: string) => {
    if (l === "") return dispatch();
    if (l.startsWith(":")) return;
    const i = l.indexOf(":");
    const field = i === -1 ? l : l.slice(0, i);
    let value = i === -1 ? "" : l.slice(i + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "id") id = value;
    else if (field === "event") event = value;
    else if (field === "data") data.push(value);
  };
  return {
    push(chunk: string) {
      buffer += chunk;
      for (;;) {
        const nl = buffer.search(/\r\n|\r|\n/);
        if (nl === -1) break;
        // A lone trailing "\r" may be the first half of "\r\n": wait for the next chunk.
        if (buffer[nl] === "\r" && nl === buffer.length - 1) break;
        const crlf = buffer[nl] === "\r" && buffer[nl + 1] === "\n";
        line(buffer.slice(0, nl));
        buffer = buffer.slice(nl + (crlf ? 2 : 1));
      }
    },
  };
}

export const STREAM_MAX_ATTEMPTS = 5;

/** How often a page checks for new events while it does not hold a stream. */
export const FOLLOW_POLL_MS = 10_000;
/** A stream that has not connected by then (a browser queues it behind its six connections). */
export const FOLLOW_CONNECT_TIMEOUT_MS = 15_000;

/**
 * How a page follows one run:
 * - `stream`: an open SSE stream (`until=suspend`, so it ends when the run starts waiting);
 * - `poll`: a short request every {@link FOLLOW_POLL_MS} for events after the last one;
 * - `paused`: nothing while the tab is hidden (it catches up when shown again);
 * - `idle`: the run has ended.
 *
 * A browser allows six HTTP/1.1 connections per host, shared by every tab, so a stream is held only
 * while the run is moving and the tab is visible: six tabs of waiting runs used to hold all six,
 * and no other FlowAId page could load.
 */
export type FollowMode = "stream" | "poll" | "paused" | "idle";

const ENDED_RUN = new Set(["completed", "failed", "cancelled", "timed_out"]);
const SUSPENDED_RUN = new Set(["waiting", "waiting_for_human"]);

export function followMode(i: {
  status: string;
  visible: boolean;
  /** The stream failed, timed out connecting or ended without the run ending. */
  streamDown: boolean;
}): FollowMode {
  if (ENDED_RUN.has(i.status)) return "idle";
  if (!i.visible) return "paused";
  if (SUSPENDED_RUN.has(i.status) || i.streamDown) return "poll";
  return "stream";
}

/** Delay before reconnect attempt `attempt` (1-based): 1 s · 2^(n-1), capped at 30 s, jittered to 50–100 %. */
export function backoffDelay(attempt: number, random: () => number = Math.random): number {
  const base = Math.min(30_000, 1000 * 2 ** Math.max(0, attempt - 1));
  return Math.round(base * (0.5 + random() * 0.5));
}

export type RunStreamStatus = "connecting" | "open" | "reconnecting" | "ended" | "failed";

export interface RunStreamState {
  status: RunStreamStatus;
  /** Reconnect attempt in progress (0 while healthy). */
  attempt: number;
  /** The stream dropped and resumed: streamed text of still-running nodes is incomplete. */
  resumed: boolean;
  /** Final status from the `END` message (`completed`, `failed`, `waiting`, `unauthorized`, …). */
  finalStatus?: string;
  error?: string;
}

export interface RunStreamOptions {
  /** `/v1/runs/<id>/stream` plus any query (`?include=deltas,logs`). */
  url: string;
  /** Headers for each (re)connect (workspace, CSRF). */
  headers?: () => Record<string, string>;
  /** Resume after this `seq` (0 = from the beginning). */
  afterSeq?: number;
  /** Every parsed event (durable ones carry `id: <seq>`; `GENERATION_DELTA` is ephemeral). */
  onEvent: (event: unknown) => void;
  onState?: (state: RunStreamState) => void;
  maxAttempts?: number;
  fetch?: typeof fetch;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  random?: () => number;
}

const defaultSleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => (clearTimeout(t), resolve()), { once: true });
  });

/** Opens the stream; returns `close()`. Never throws: failures surface through `onState`. */
export function openRunStream(o: RunStreamOptions): { close: () => void } {
  const controller = new AbortController();
  const signal = controller.signal;
  const doFetch = o.fetch ?? globalThis.fetch.bind(globalThis);
  const sleep = o.sleep ?? defaultSleep;
  const max = o.maxAttempts ?? STREAM_MAX_ATTEMPTS;
  let lastSeq = o.afterSeq ?? 0;
  const state: RunStreamState = { status: "connecting", attempt: 0, resumed: false };
  const emit = (patch: Partial<RunStreamState>) => {
    Object.assign(state, patch);
    if (!signal.aborted) o.onState?.({ ...state });
  };

  const run = async () => {
    let everOpened = false;
    for (;;) {
      if (signal.aborted) return;
      let ended = false;
      try {
        const res = await doFetch(o.url, {
          method: "GET",
          credentials: "same-origin",
          headers: {
            accept: "text/event-stream",
            ...o.headers?.(),
            ...(lastSeq > 0 ? { "last-event-id": String(lastSeq) } : {}),
          },
          signal,
        });
        if (!res.ok || !res.body) {
          // 4xx are final (gone, forbidden, expired Last-Event-ID); 5xx are retried.
          if (res.status >= 400 && res.status < 500) {
            emit({ status: "failed", error: `HTTP ${res.status}` });
            return;
          }
          throw new Error(`HTTP ${res.status}`);
        }
        emit({ status: "open", attempt: 0, ...(everOpened ? { resumed: true } : {}) });
        everOpened = true;
        const parser = createSseParser((m) => {
          if (ended) return;
          if (m.id !== undefined && /^\d+$/.test(m.id)) lastSeq = Math.max(lastSeq, Number(m.id));
          let payload: unknown;
          try {
            payload = JSON.parse(m.data);
          } catch {
            return;
          }
          if (m.event === "END") {
            ended = true;
            const p = payload as { final_status?: string; reason?: string };
            emit({ status: "ended", finalStatus: p.final_status ?? p.reason ?? "ended" });
            return;
          }
          o.onEvent(payload);
        });
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          parser.push(decoder.decode(value, { stream: true }));
          if (ended) {
            void reader.cancel().catch(() => undefined);
            return;
          }
        }
        throw new Error("the stream closed");
      } catch (error) {
        if (signal.aborted || ended) return;
        const attempt = state.attempt + 1;
        if (attempt > max) {
          emit({
            status: "failed",
            attempt,
            error: error instanceof Error ? error.message : String(error),
          });
          return;
        }
        emit({ status: "reconnecting", attempt });
        await sleep(backoffDelay(attempt, o.random), signal);
      }
    }
  };
  emit({ status: "connecting" });
  void run();
  return { close: () => controller.abort() };
}
