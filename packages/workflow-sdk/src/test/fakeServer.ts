/**
 * A scripted `fetch` for SDK tests: each request is matched against handlers in order and answered
 * with JSON, an error envelope or an SSE body whose chunks the test controls (including a
 * connection that drops mid-stream).
 */
export interface Recorded {
  method: string;
  url: URL;
  headers: Record<string, string>;
  body: unknown;
}

export type Handler = (req: Recorded) => Response | undefined | Promise<Response | undefined>;

export function json(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

export function apiError(status: number, code: string, details?: unknown): Response {
  return json(status, {
    error: {
      code,
      message: code.toLowerCase(),
      retryable: status >= 500,
      request_id: "req-1",
      details,
    },
  });
}

/** An SSE response; `drop: true` errors the stream after the chunks (a dropped connection). */
export function sse(chunks: string[], o: { drop?: boolean } = {}): Response {
  const encoder = new TextEncoder();
  // Pull-based, so every chunk is read before the error (erroring discards queued chunks).
  const queue = [...chunks];
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      const next = queue.shift();
      if (next !== undefined) controller.enqueue(encoder.encode(next));
      else if (o.drop) controller.error(new TypeError("network connection lost"));
      else controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

export const frame = (event: { type: string; seq?: number } & Record<string, unknown>) =>
  `${event.seq ? `id: ${event.seq}\n` : ""}event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;

export const end = (runId: string, status = "completed") =>
  `event: END\ndata: ${JSON.stringify({ run_id: runId, final_status: status })}\n\n`;

export function fakeFetch(handlers: Handler[]) {
  const requests: Recorded[] = [];
  const impl = async (input: string | URL | Request, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
    );
    const headers = Object.fromEntries(
      Object.entries((init.headers ?? {}) as Record<string, string>).map(([k, v]) => [
        k.toLowerCase(),
        v,
      ]),
    );
    const req: Recorded = {
      method: init.method ?? "GET",
      url,
      headers,
      body: typeof init.body === "string" ? JSON.parse(init.body) : undefined,
    };
    requests.push(req);
    for (const h of handlers) {
      const res = await h(req);
      if (res) return res;
    }
    return apiError(404, "NOT_FOUND");
  };
  return { fetch: impl, requests };
}

export const noWait = { sleep: () => Promise.resolve(), random: () => 0.5 };
