/**
 * `TypeSafeClient`: `GET /v1/models` and `POST /v1/systemone` over the platform's SafeFetch.
 *
 * - Every call honours the caller's AbortSignal (also while waiting between retries).
 * - 429 is retried up to 5 times inside the call, waiting `Retry-After` when the server sends it,
 *   else full-jitter backoff from 500 ms to 16 s; after that it surfaces as
 *   ProviderRateLimitedError (the runtime's durable retry takes over).
 * - Errors map to the flowaid taxonomy: 401/403 → CredentialError; 400 (semantic validation) and
 *   422 (request shape) → non-retryable ProviderError with the details (no failover: the request
 *   itself is wrong);
 *   429 → ProviderRateLimitedError; 529/503 → ProviderOverloadedError (failover-eligible);
 *   other 5xx → retryable ProviderError; a transport failure → NetworkError.
 */
import { retryAfterMs } from "@flowaid/providers";
import {
  CancelledError,
  CredentialError,
  NetworkError,
  ProviderError,
  ProviderOverloadedError,
  ProviderRateLimitedError,
  type FlowaidError,
  type JsonValue,
  type SafeFetch,
} from "@flowaid/workflow-core";
import {
  ModelsResponseSchema,
  SystemOneErrorSchema,
  SystemOneRequestSchema,
  SystemOneResponseSchema,
  TYPESAFE_BASE_URL,
  type SystemOneRequest,
  type SystemOneResponse,
  type TypeSafeModel,
} from "./schemas.js";

export const RATE_LIMIT_RETRIES = 5;
const BACKOFF_BASE_MS = 500;
const BACKOFF_MAX_MS = 16_000;

export interface TypeSafeClientOptions {
  apiKey: string;
  baseUrl?: string;
  http: SafeFetch;
  /** Wait helper (tests pass an instant one). */
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  random?: () => number;
  now?: () => number;
}

function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new CancelledError("The TypeSafe request was cancelled"));
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new CancelledError("The TypeSafe request was cancelled"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/** The flowaid error for a failed TypeSafe response. */
export function typesafeError(status: number, body: string, headers: Headers): FlowaidError {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    parsed = undefined;
  }
  const detail = SystemOneErrorSchema.safeParse(parsed);
  const d = detail.success ? detail.data.detail : null;
  const message =
    d === null
      ? body.slice(0, 500)
      : typeof d === "string"
        ? d
        : Array.isArray(d)
          ? d.map((x) => `${x.loc.join(".")}: ${x.msg}`).join("; ")
          : d.message;
  if (status === 401 || status === 403)
    return new CredentialError(`TypeSafe rejected the API key: ${message}`);
  // 400 (semantic) and 422 (shape): the request itself is wrong, so neither retry nor failover helps.
  if (status === 400 || status === 422)
    return new ProviderError(
      `TypeSafe rejected the request: ${message}`,
      false,
      "typesafe",
      Array.isArray(d) ? (d as unknown as JsonValue) : message,
    );
  if (status === 429)
    return new ProviderRateLimitedError("typesafe", retryAfterMs(headers.get("retry-after")));
  if (status === 529 || status === 503) return new ProviderOverloadedError("typesafe");
  if (status >= 500)
    return new ProviderError(`TypeSafe failed (${status}): ${message}`, true, "typesafe");
  return new ProviderError(
    `TypeSafe refused the request (${status}): ${message}`,
    false,
    "typesafe",
  );
}

export class TypeSafeClient {
  private readonly baseUrl: string;
  private readonly sleep: (ms: number, signal: AbortSignal) => Promise<void>;
  private readonly random: () => number;
  private readonly now: () => number;

  constructor(private readonly options: TypeSafeClientOptions) {
    this.baseUrl = (options.baseUrl ?? TYPESAFE_BASE_URL).replace(/\/+$/, "");
    this.sleep = options.sleep ?? abortableSleep;
    this.random = options.random ?? Math.random;
    this.now = options.now ?? Date.now;
  }

  private async send(path: string, init: RequestInit, signal: AbortSignal): Promise<Response> {
    for (let attempt = 0; ; attempt += 1) {
      let response: Response;
      try {
        response = await this.options.http(`${this.baseUrl}${path}`, {
          ...init,
          signal,
          headers: {
            authorization: `Bearer ${this.options.apiKey}`,
            accept: "application/json",
            ...(init.body ? { "content-type": "application/json" } : {}),
          },
        });
      } catch (error) {
        if (signal.aborted) throw new CancelledError("The TypeSafe request was cancelled");
        throw new NetworkError(
          `TypeSafe could not be reached: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      if (response.ok) return response;
      const body = await response.text();
      if (response.status === 429 && attempt < RATE_LIMIT_RETRIES) {
        const wait =
          retryAfterMs(response.headers.get("retry-after"), this.now()) ??
          Math.round(this.random() * Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** attempt));
        await this.sleep(wait, signal);
        continue;
      }
      throw typesafeError(response.status, body, response.headers);
    }
  }

  /** `GET /v1/models`. */
  async models(signal: AbortSignal): Promise<TypeSafeModel[]> {
    const response = await this.send("/v1/models", { method: "GET" }, signal);
    const parsed = ModelsResponseSchema.safeParse(await response.json());
    if (!parsed.success)
      throw new ProviderError("TypeSafe returned an unexpected model list", true, "typesafe");
    return parsed.data.models;
  }

  /** `POST /v1/systemone`. */
  async systemOne(
    req: SystemOneRequest,
    signal: AbortSignal,
  ): Promise<{ body: SystemOneResponse; requestId: string | null; latencyMs: number }> {
    const request = SystemOneRequestSchema.parse(req);
    const started = this.now();
    const response = await this.send(
      "/v1/systemone",
      { method: "POST", body: JSON.stringify(request) },
      signal,
    );
    const json: unknown = await response.json();
    const parsed = SystemOneResponseSchema.safeParse(json);
    if (!parsed.success)
      throw new ProviderError(
        `TypeSafe returned an unexpected answer: ${parsed.error.issues[0]?.message ?? "invalid"}`,
        true,
        "typesafe",
      );
    return {
      body: parsed.data,
      requestId: response.headers.get("x-typesafe-request-id"),
      latencyMs: Math.max(0, this.now() - started),
    };
  }
}
