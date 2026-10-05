import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useRunStream } from "./useRunStream";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  setVisibility("visible");
});

function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
  document.dispatchEvent(new Event("visibilitychange"));
}

/** An SSE response that stays open until the request is aborted. */
function openStream(signal: AbortSignal | null | undefined, chunks: string[] = []): Response {
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(enc.encode("retry: 2000\n: connected\n\n"));
      for (const ch of chunks) c.enqueue(enc.encode(ch));
      signal?.addEventListener("abort", () => c.error(new DOMException("aborted", "AbortError")));
    },
  });
  return new Response(body, { headers: { "content-type": "text/event-stream" } });
}

interface Call {
  url: string;
  init: RequestInit | undefined;
}

/** `fetch` for one run: the stream (by `stream`), and events pages after the asked `seq`. */
function stubRun(o: {
  stream?: (init: RequestInit | undefined) => Promise<Response>;
  events?: (after: number) => unknown[];
}) {
  const calls: Call[] = [];
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    calls.push({ url, init });
    if (url.startsWith("/v1/runs/r1/stream"))
      return o.stream ? o.stream(init) : Promise.resolve(openStream(init?.signal));
    if (url.startsWith("/v1/runs/r1/events")) {
      const after = Number(new URL(url, "http://x").searchParams.get("after"));
      return Promise.resolve(Response.json({ items: o.events?.(after) ?? [], next_cursor: null }));
    }
    return Promise.resolve(Response.json({ error: { code: "NOT_FOUND" } }, { status: 404 }));
  });
  vi.stubGlobal("fetch", fetchMock);
  return {
    calls,
    streams: () => calls.filter((c) => c.url.startsWith("/v1/runs/r1/stream")),
    polls: () => calls.filter((c) => c.url.startsWith("/v1/runs/r1/events")),
  };
}

function Probe({
  status,
  onEvents = () => undefined,
}: {
  status: string;
  onEvents?: (events: unknown[]) => void;
}) {
  const s = useRunStream("r1", {
    status,
    afterSeq: 4,
    onEvents,
    pollMs: 30,
    connectTimeoutMs: 60,
  });
  return (
    <div>
      <output data-testid="mode">{s.mode}</output>
      <output data-testid="fallback">{s.fallback ? "yes" : "no"}</output>
      <button type="button" onClick={s.reconnect}>
        Reconnect
      </button>
    </div>
  );
}

const mode = () => screen.getByTestId("mode").textContent;

describe("useRunStream", () => {
  it("streams a running run until it suspends, resuming after the loaded events", async () => {
    const api = stubRun({});
    render(<Probe status="running" />);
    await waitFor(() => expect(api.streams()).toHaveLength(1));
    const [first] = api.streams();
    expect(first?.url).toContain("until=suspend");
    expect((first?.init?.headers as Record<string, string>)["last-event-id"]).toBe("4");
    expect(mode()).toBe("stream");
  });

  it("holds no stream while the run waits for a person, and polls for new events instead", async () => {
    const api = stubRun({ events: (after) => (after === 4 ? [{ seq: 5, type: "LOG" }] : []) });
    const onEvents = vi.fn();
    render(<Probe status="waiting_for_human" onEvents={onEvents} />);
    expect(mode()).toBe("poll");
    await waitFor(() => expect(api.polls().length).toBeGreaterThanOrEqual(2));
    expect(api.streams()).toHaveLength(0);
    expect(api.polls().map((c) => new URL(c.url, "http://x").searchParams.get("after"))).toEqual(
      expect.arrayContaining(["4", "5"]),
    );
    expect(onEvents).toHaveBeenCalledWith([{ seq: 5, type: "LOG" }]);
  });

  it("closes the stream while the tab is hidden and reopens it when shown", async () => {
    const api = stubRun({});
    render(<Probe status="running" />);
    await waitFor(() => expect(api.streams()).toHaveLength(1));
    act(() => setVisibility("hidden"));
    expect(mode()).toBe("paused");
    expect(api.streams()[0]?.init?.signal?.aborted).toBe(true);
    await new Promise((r) => setTimeout(r, 80));
    expect(api.polls()).toHaveLength(0);
    act(() => setVisibility("visible"));
    await waitFor(() => expect(api.streams()).toHaveLength(2));
  });

  it("falls back to polling when the stream never connects, and Reconnect tries again", async () => {
    // the browser queues the request behind its other connections: it never answers
    const api = stubRun({
      stream: (init) =>
        new Promise((_, reject) =>
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          ),
        ),
    });
    render(<Probe status="running" />);
    await waitFor(() => expect(screen.getByTestId("fallback").textContent).toBe("yes"));
    expect(mode()).toBe("poll");
    expect(api.streams()[0]?.init?.signal?.aborted).toBe(true);
    await waitFor(() => expect(api.polls().length).toBeGreaterThanOrEqual(1));
    fireEvent.click(screen.getByRole("button", { name: "Reconnect" }));
    expect(mode()).toBe("stream");
    await waitFor(() => expect(api.streams()).toHaveLength(2));
  });

  it("stops when the run moves from running to waiting, and streams again once it resumes", async () => {
    const api = stubRun({});
    const view = render(<Probe status="running" />);
    await waitFor(() => expect(api.streams()).toHaveLength(1));
    view.rerender(<Probe status="waiting_for_human" />);
    expect(mode()).toBe("poll");
    expect(api.streams()[0]?.init?.signal?.aborted).toBe(true);
    view.rerender(<Probe status="running" />);
    await waitFor(() => expect(api.streams()).toHaveLength(2));
    view.rerender(<Probe status="completed" />);
    expect(mode()).toBe("idle");
  });
});
