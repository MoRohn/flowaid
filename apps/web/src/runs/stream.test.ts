import { describe, expect, it, vi } from "vitest";
import {
  backoffDelay,
  createSseParser,
  followMode,
  openRunStream,
  type RunStreamState,
  type SseMessage,
} from "./stream";

function sseBody(chunks: string[], { hang = false } = {}): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(c) {
      for (const ch of chunks) c.enqueue(enc.encode(ch));
      if (!hang) c.close();
    },
  });
}
const ev = (seq: number, type = "NODE_STARTED") =>
  `id: ${seq}\nevent: ${type}\ndata: ${JSON.stringify({ seq, type })}\n\n`;
const END = `event: END\ndata: {"final_status":"completed"}\n\n`;

async function settle(states: RunStreamState[], until: (s: RunStreamState) => boolean) {
  for (let i = 0; i < 500 && !states.some(until); i++) await new Promise((r) => setTimeout(r, 1));
}

describe("createSseParser", () => {
  it("parses ids, events, multi-line data and comments across chunk boundaries", () => {
    const out: SseMessage[] = [];
    const p = createSseParser((m) => out.push(m));
    p.push("retry: 2000\n: connected\n\nid: 7\nevent: LO");
    p.push("G\ndata: a\r");
    p.push("\ndata: b\n\nevent: END\ndata: {}\n\n");
    expect(out).toEqual([
      { id: "7", event: "LOG", data: "a\nb" },
      { event: "END", data: "{}" },
    ]);
  });
});

describe("backoffDelay", () => {
  it("doubles from 1 s, caps at 30 s and jitters to 50–100 %", () => {
    expect(backoffDelay(1, () => 1)).toBe(1000);
    expect(backoffDelay(2, () => 1)).toBe(2000);
    expect(backoffDelay(4, () => 0)).toBe(4000);
    expect(backoffDelay(10, () => 1)).toBe(30_000);
  });
});

describe("openRunStream", () => {
  it("delivers events and stops at END", async () => {
    const events: unknown[] = [];
    const states: RunStreamState[] = [];
    const fetch = vi.fn(() => Promise.resolve(new Response(sseBody([ev(1), ev(2), END]))));
    openRunStream({
      url: "/s",
      onEvent: (e) => events.push(e),
      onState: (s) => states.push(s),
      fetch,
    });
    await settle(states, (s) => s.status === "ended");
    expect(events).toEqual([
      { seq: 1, type: "NODE_STARTED" },
      { seq: 2, type: "NODE_STARTED" },
    ]);
    expect(states.at(-1)).toMatchObject({
      status: "ended",
      finalStatus: "completed",
      resumed: false,
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("reconnects with Last-Event-ID after a drop and flags the resume", async () => {
    const seen: Array<string | undefined> = [];
    const states: RunStreamState[] = [];
    let n = 0;
    const fetch = vi.fn((_url: string, init?: RequestInit) => {
      seen.push((init?.headers as Record<string, string>)["last-event-id"]);
      n++;
      return Promise.resolve(new Response(sseBody(n === 1 ? [ev(4)] : [ev(5), END])));
    });
    const sleep = vi.fn(() => Promise.resolve());
    openRunStream({
      url: "/s",
      afterSeq: 3,
      onEvent: () => undefined,
      onState: (s) => states.push(s),
      fetch: fetch as unknown as typeof globalThis.fetch,
      sleep,
      random: () => 1,
    });
    await settle(states, (s) => s.status === "ended");
    expect(seen).toEqual(["3", "4"]);
    expect(sleep).toHaveBeenCalledWith(1000, expect.anything());
    expect(states.at(-1)).toMatchObject({ status: "ended", resumed: true });
  });

  it("gives up after five failed attempts in a row", async () => {
    const states: RunStreamState[] = [];
    const fetch = vi.fn(() => Promise.reject(new TypeError("network down")));
    const sleep = vi.fn((_ms: number) => Promise.resolve());
    openRunStream({
      url: "/s",
      onEvent: () => undefined,
      onState: (s) => states.push(s),
      fetch,
      sleep,
      random: () => 1,
    });
    await settle(states, (s) => s.status === "failed");
    expect(fetch).toHaveBeenCalledTimes(6);
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([1000, 2000, 4000, 8000, 16_000]);
    expect(states.at(-1)).toMatchObject({ status: "failed", error: "network down" });
  });

  it("does not retry client errors", async () => {
    const states: RunStreamState[] = [];
    const fetch = vi.fn(() => Promise.resolve(new Response("{}", { status: 404 })));
    openRunStream({ url: "/s", onEvent: () => undefined, onState: (s) => states.push(s), fetch });
    await settle(states, (s) => s.status === "failed");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(states.at(-1)).toMatchObject({ status: "failed", error: "HTTP 404" });
  });

  it("close() aborts without reporting a failure", async () => {
    const states: RunStreamState[] = [];
    const fetch = vi.fn(() => Promise.resolve(new Response(sseBody([ev(1)], { hang: true }))));
    const s = openRunStream({
      url: "/s",
      onEvent: () => undefined,
      onState: (st) => states.push(st),
      fetch,
    });
    await settle(states, (st) => st.status === "open");
    s.close();
    await new Promise((r) => setTimeout(r, 10));
    expect(states.some((st) => st.status === "failed" || st.status === "reconnecting")).toBe(false);
  });
});

describe("followMode", () => {
  const base = { status: "running", visible: true, streamDown: false };
  it("streams a moving run in a visible tab", () => {
    expect(followMode(base)).toBe("stream");
    expect(followMode({ ...base, status: "queued" })).toBe("stream");
    expect(followMode({ ...base, status: "retrying" })).toBe("stream");
  });
  it("polls instead of holding a connection while the run waits", () => {
    expect(followMode({ ...base, status: "waiting_for_human" })).toBe("poll");
    expect(followMode({ ...base, status: "waiting" })).toBe("poll");
  });
  it("polls while the stream is down", () => {
    expect(followMode({ ...base, streamDown: true })).toBe("poll");
  });
  it("holds nothing in a hidden tab or for an ended run", () => {
    expect(followMode({ ...base, visible: false })).toBe("paused");
    expect(followMode({ ...base, status: "waiting_for_human", visible: false })).toBe("paused");
    for (const status of ["completed", "failed", "cancelled", "timed_out"])
      expect(followMode({ ...base, status })).toBe("idle");
  });
});
