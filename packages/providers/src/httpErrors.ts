/**
 * Provider HTTP errors → the flowaid error taxonomy (ARCHITECTURE.md §6.6): 401/403 →
 * CredentialError; 429 → ProviderRateLimitedError (with Retry-After); 503/529 →
 * ProviderOverloadedError; other 5xx → retryable ProviderError; other 4xx → non-retryable
 * ProviderError; a context-length error → BoundsExceededError('maxTokens').
 */
import {
  BoundsExceededError,
  CredentialError,
  ProviderError,
  ProviderOverloadedError,
  ProviderRateLimitedError,
  type FlowaidError,
} from "@flowaid/workflow-core";

/** Retry-After in ms (seconds or an HTTP date). */
export function retryAfterMs(header: string | null, now = Date.now()): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, Math.round(seconds * 1000));
  const at = Date.parse(header);
  return Number.isNaN(at) ? undefined : Math.max(0, at - now);
}

function messageOf(body: string): string {
  try {
    const parsed = JSON.parse(body) as {
      error?: { message?: unknown } | string;
      message?: unknown;
      detail?: unknown;
    };
    if (typeof parsed.error === "string") return parsed.error;
    if (typeof parsed.error?.message === "string") return parsed.error.message;
    if (typeof parsed.message === "string") return parsed.message;
    if (parsed.detail !== undefined) return JSON.stringify(parsed.detail).slice(0, 500);
  } catch {
    // not JSON
  }
  return body.slice(0, 500);
}

export function errorFromResponse(
  provider: string,
  status: number,
  headers: Headers,
  body: string,
): FlowaidError {
  const message = messageOf(body);
  if (/context[_ ]length|maximum context|too many tokens|prompt is too long/i.test(message)) {
    return new BoundsExceededError("maxTokens", 0, 0);
  }
  if (status === 401 || status === 403)
    return new CredentialError(`${provider} rejected the credential: ${message}`);
  if (status === 429)
    return new ProviderRateLimitedError(provider, retryAfterMs(headers.get("retry-after")));
  if (status === 503 || status === 529) return new ProviderOverloadedError(provider);
  if (status >= 500)
    return new ProviderError(`${provider} failed (${status}): ${message}`, true, provider);
  return new ProviderError(
    `${provider} refused the request (${status}): ${message}`,
    false,
    provider,
  );
}
