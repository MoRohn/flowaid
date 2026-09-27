/**
 * LangChain / vendor SDK errors → the flowaid error taxonomy (ARCHITECTURE.md §6.6). Vendor SDKs
 * throw their own classes; what they share is an HTTP `status` (sometimes under `response`),
 * `headers`, and LangChain's `lc_error_code`. Aborts become `CancelledError`; errors that are
 * already flowaid errors pass through.
 */
import {
  BoundsExceededError,
  CancelledError,
  CredentialError,
  FlowaidError,
  ProviderError,
  ProviderOverloadedError,
  ProviderRateLimitedError,
  TimeoutError,
} from "@flowaid/workflow-core";
import { retryAfterMs } from "@flowaid/providers";

type Loose = Record<string, unknown>;
const isLoose = (v: unknown): v is Loose => typeof v === "object" && v !== null;

function headerOf(error: Loose, name: string): string | null {
  const headers = error.headers ?? (isLoose(error.response) ? error.response.headers : undefined);
  if (!headers) return null;
  if (typeof (headers as Headers).get === "function") return (headers as Headers).get(name);
  if (isLoose(headers)) {
    const v = headers[name] ?? headers[name.toLowerCase()];
    return typeof v === "string" ? v : null;
  }
  return null;
}

export function toProviderError(error: unknown, provider: string): FlowaidError {
  if (error instanceof FlowaidError) return error;
  if (!isLoose(error)) return new ProviderError(String(error), false, provider);
  const name = typeof error.name === "string" ? error.name : "";
  const message = typeof error.message === "string" ? error.message : JSON.stringify(error);
  if (name === "AbortError" || /aborted|abort signal/i.test(message))
    return new CancelledError(`${provider}: the call was cancelled`);
  if (name === "TimeoutError" || /timed? ?out/i.test(message))
    return new TimeoutError(`${provider}: the call timed out`);
  const response = isLoose(error.response) ? error.response : undefined;
  const status = Number(error.status ?? error.statusCode ?? response?.status ?? NaN);
  const code = error.lc_error_code;
  if (
    code === "MODEL_AUTHENTICATION" ||
    status === 401 ||
    status === 403 ||
    /invalid api key|incorrect api key|authentication/i.test(message)
  )
    return new CredentialError(`${provider} rejected the credential: ${message}`);
  if (/context[_ ]length|maximum context|too many tokens|prompt is too long/i.test(message))
    return new BoundsExceededError("maxTokens", 0, 0);
  if (code === "MODEL_RATE_LIMIT" || status === 429)
    return new ProviderRateLimitedError(provider, retryAfterMs(headerOf(error, "retry-after")));
  if (status === 503 || status === 529 || /overloaded/i.test(message))
    return new ProviderOverloadedError(provider);
  if (Number.isFinite(status) && status >= 500)
    return new ProviderError(`${provider} failed (${status}): ${message}`, true, provider);
  if (Number.isFinite(status) && status >= 400)
    return new ProviderError(
      `${provider} refused the request (${status}): ${message}`,
      false,
      provider,
    );
  if (/ECONNRESET|ECONNREFUSED|ETIMEDOUT|fetch failed|network/i.test(message))
    return new ProviderError(`${provider}: ${message}`, true, provider);
  return new ProviderError(`${provider}: ${message}`, false, provider);
}
