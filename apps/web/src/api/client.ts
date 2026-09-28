/**
 * The browser API client. Requests go same-origin (`/v1/*` is rewritten to the API), carry the
 * session cookie, the CSRF header and the workspace slug; a 401 refreshes the session once
 * (single-flight) and retries. Errors surface as `ApiError` with the envelope's code and message.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

let workspaceSlug: string | null = null;
/** The workspace every request targets (the `[ws]` route segment). */
export function setWorkspace(slug: string | null): void {
  workspaceSlug = slug;
}
export function currentWorkspace(): string | null {
  return workspaceSlug;
}

const authPost = (path: string) =>
  fetch(path, {
    method: "POST",
    credentials: "same-origin",
    headers: { "x-requested-with": "flowaid" },
  })
    .then((r) => r.ok)
    .catch(() => false);

/**
 * Local mode (FlowAId on your own computer): the api signs this computer in as the owner, no
 * password. Answers false where local sign-in is off or refused, and the login page takes over.
 */
export function signInLocally(): Promise<boolean> {
  return authPost("/v1/auth/local");
}

let refreshing: Promise<boolean> | null = null;
/** A 401: rotate the refresh token, or else sign in locally when the api allows it. */
async function refreshSession(): Promise<boolean> {
  refreshing ??= authPost("/v1/auth/refresh")
    .then((ok) => ok || signInLocally())
    .finally(() => setTimeout(() => (refreshing = null), 0));
  return refreshing;
}

export interface RequestOptions {
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  /** return the raw Response (downloads, streams) */
  raw?: boolean;
  /** do not try to refresh on 401 (auth routes) */
  noRefresh?: boolean;
}

export function requestHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    "x-requested-with": "flowaid",
    ...(workspaceSlug ? { "x-workspace": workspaceSlug } : {}),
    ...extra,
  };
}

async function toError(res: Response): Promise<ApiError> {
  let code = `HTTP_${res.status}`;
  let message = res.statusText || "request failed";
  let details: unknown;
  try {
    const body = (await res.json()) as {
      error?: { code?: string; message?: string; details?: unknown };
    };
    if (body.error) {
      code = body.error.code ?? code;
      message = body.error.message ?? message;
      details = body.error.details;
    }
  } catch {
    /* not JSON */
  }
  return new ApiError(res.status, code, message, details);
}

export async function api<T = unknown>(
  method: string,
  path: string,
  o: RequestOptions = {},
): Promise<T> {
  const send = () =>
    fetch(path, {
      method,
      credentials: "same-origin",
      headers: requestHeaders({
        ...(o.body !== undefined ? { "content-type": "application/json" } : {}),
        ...o.headers,
      }),
      ...(o.body !== undefined ? { body: JSON.stringify(o.body) } : {}),
      ...(o.signal ? { signal: o.signal } : {}),
    });
  let res = await send();
  if (res.status === 401 && !o.noRefresh && (await refreshSession())) res = await send();
  if (!res.ok) throw await toError(res);
  if (o.raw) return res as unknown as T;
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export const get = <T>(path: string, o?: RequestOptions) => api<T>("GET", path, o);
export const post = <T>(path: string, body?: unknown, o?: RequestOptions) =>
  api<T>("POST", path, { ...o, body: body ?? {} });
export const put = <T>(path: string, body?: unknown, o?: RequestOptions) =>
  api<T>("PUT", path, { ...o, body: body ?? {} });
export const patch = <T>(path: string, body?: unknown, o?: RequestOptions) =>
  api<T>("PATCH", path, { ...o, body: body ?? {} });
export const del = <T>(path: string, o?: RequestOptions) => api<T>("DELETE", path, o);

/** `?a=1&b=2` from defined values only. */
export function qs(params: Record<string, string | number | boolean | undefined | null>): string {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params))
    if (v !== undefined && v !== null && v !== "") u.set(k, String(v));
  const s = u.toString();
  return s ? `?${s}` : "";
}
