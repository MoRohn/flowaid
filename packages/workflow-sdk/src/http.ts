/**
 * The HTTP transport under every SDK call: base URL, auth (an API key as a bearer token, or the
 * browser's session cookie), `X-Requested-With` (the API's CSRF header for cookie mutations),
 * `X-Workspace`, JSON in and out, and the error envelope as {@link FlowaidApiError}. Uses the
 * global `fetch` (Node 24, browsers) unless one is injected.
 */
import { FlowaidApiError, type ErrorEnvelope } from "./errors.js";

export interface FlowaidOptions {
  /** API origin, e.g. `http://localhost:3001` (a trailing slash or `/v1` suffix is accepted). */
  baseUrl: string;
  /** `fa_live_…` / `fa_test_…`, sent as `Authorization: Bearer`. */
  apiKey?: string;
  /** Browser session: send cookies with every request (`credentials: 'include'`). */
  cookies?: boolean;
  /** Workspace slug or id for principals that can see several (`X-Workspace`). */
  workspace?: string;
  /** Extra headers on every request. */
  headers?: Record<string, string>;
  /** A `fetch` implementation (tests, proxies); defaults to the global one. */
  fetch?: typeof fetch;
}

export type QueryValue = string | number | boolean | readonly (string | number)[] | undefined;

export interface RequestOptions {
  query?: Record<string, QueryValue> | undefined;
  body?: unknown;
  headers?: Record<string, string> | undefined;
  signal?: AbortSignal | undefined;
}

export class Transport {
  readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(readonly options: FlowaidOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "").replace(/\/v1$/, "");
    const f = options.fetch ?? globalThis.fetch;
    // Keep the global's receiver: some runtimes throw "Illegal invocation" otherwise.
    this.fetchImpl = options.fetch ? f : (input, init) => globalThis.fetch(input, init);
  }

  url(path: string, query?: Record<string, QueryValue>): string {
    const url = new URL(`${this.baseUrl}${path.startsWith("/") ? path : `/${path}`}`);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value === undefined) continue;
      url.searchParams.set(key, Array.isArray(value) ? value.join(",") : String(value));
    }
    return url.toString();
  }

  headers(extra?: Record<string, string>): Record<string, string> {
    return {
      "x-requested-with": "flowaid",
      ...(this.options.apiKey ? { authorization: `Bearer ${this.options.apiKey}` } : {}),
      ...(this.options.workspace ? { "x-workspace": this.options.workspace } : {}),
      ...this.options.headers,
      ...extra,
    };
  }

  /** The raw response of a successful call; a non-2xx status throws {@link FlowaidApiError}. */
  async raw(method: string, path: string, o: RequestOptions = {}): Promise<Response> {
    const hasBody = o.body !== undefined;
    const res = await this.fetchImpl(this.url(path, o.query), {
      method,
      headers: this.headers({
        ...(hasBody ? { "content-type": "application/json" } : {}),
        ...o.headers,
      }),
      ...(hasBody ? { body: JSON.stringify(o.body) } : {}),
      ...(this.options.cookies ? { credentials: "include" as const } : {}),
      ...(o.signal ? { signal: o.signal } : {}),
    });
    if (!res.ok) throw await toApiError(res);
    return res;
  }

  /** JSON in, JSON out; `204` resolves to `undefined`. */
  async request<T>(method: string, path: string, o: RequestOptions = {}): Promise<T> {
    const res = await this.raw(method, path, o);
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }
}

export async function toApiError(res: Response): Promise<FlowaidApiError> {
  let envelope: Partial<ErrorEnvelope["error"]> = {};
  try {
    const body = (await res.json()) as Partial<ErrorEnvelope>;
    if (body && typeof body === "object" && body.error) envelope = body.error;
  } catch {
    // not JSON: keep the status line
  }
  return new FlowaidApiError(res.status, envelope, `${res.status} ${res.statusText}`.trim());
}
