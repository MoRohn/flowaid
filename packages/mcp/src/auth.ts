/**
 * MCP auth: static headers (`mcp.headers`), bearer tokens (`http.bearer`) and OAuth 2.1 tokens
 * (`mcp.oauth`, refreshed here and persisted through `onRefresh`), plus the PKCE helpers used by the
 * API's authorisation flow.
 */
import { createHash, randomBytes } from "node:crypto";
import { BadRequestError, CredentialError } from "@flowaid/workflow-core";

export type CredentialFields = Readonly<Record<string, string>>;
export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

const FORBIDDEN = new Set([
  "host",
  "content-length",
  "connection",
  "transfer-encoding",
  "mcp-session-id",
  "mcp-protocol-version",
]);

/** Headers for a bound credential (none → {}). Header names the transport owns are refused. */
export function headersFromCredential(
  fields: CredentialFields | undefined,
): Record<string, string> {
  if (!fields) return {};
  let headers: Record<string, string> = {};
  if (fields.headers !== undefined) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(fields.headers);
    } catch {
      throw new CredentialError("mcp.headers must be a JSON object of header name → value");
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
      throw new CredentialError("mcp.headers must be a JSON object");
    headers = Object.fromEntries(Object.entries(parsed).map(([k, v]) => [k, String(v)]));
  } else if (fields.accessToken !== undefined)
    headers = { Authorization: `Bearer ${fields.accessToken}` };
  else if (fields.token !== undefined) headers = { Authorization: `Bearer ${fields.token}` };
  for (const [k, v] of Object.entries(headers)) {
    if (FORBIDDEN.has(k.toLowerCase()))
      throw new BadRequestError(`the ${k} header is managed by the MCP transport`);
    if (/[\r\n]/.test(v) || /[\r\n:]/.test(k))
      throw new BadRequestError(`header ${k} contains an illegal character`);
  }
  return headers;
}

/** True when an `mcp.oauth` access token expires within `skewMs`. */
export function oauthNeedsRefresh(fields: CredentialFields, now: number, skewMs = 60_000): boolean {
  return fields.expiresAt !== undefined && Date.parse(fields.expiresAt) - skewMs <= now;
}

/** Exchanges the refresh token (RFC 6749 §6) and returns the updated credential fields. */
export async function refreshOAuthToken(
  fields: CredentialFields,
  fetch: FetchLike,
  now: number,
  signal?: AbortSignal,
): Promise<Record<string, string>> {
  if (!fields.refreshToken || !fields.tokenUrl)
    throw new CredentialError(
      "the MCP OAuth token expired and cannot be refreshed (no refreshToken/tokenUrl)",
    );
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: fields.refreshToken,
  });
  if (fields.clientId) body.set("client_id", fields.clientId);
  const res = await fetch(fields.tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: body.toString(),
    ...(signal ? { signal } : {}),
  });
  if (!res.ok) throw new CredentialError(`the MCP OAuth token refresh failed with ${res.status}`);
  const json = (await res.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };
  if (!json.access_token)
    throw new CredentialError("the MCP OAuth token response has no access_token");
  const next: Record<string, string> = { ...fields, accessToken: json.access_token };
  if (json.refresh_token) next.refreshToken = json.refresh_token;
  if (json.expires_in !== undefined)
    next.expiresAt = new Date(now + json.expires_in * 1000).toISOString();
  return next;
}

const base64url = (b: Buffer) =>
  b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** PKCE (RFC 7636): a 43-character verifier and its S256 challenge. */
export function createPkcePair(): { verifier: string; challenge: string; method: "S256" } {
  const verifier = base64url(randomBytes(32));
  return { verifier, challenge: pkceChallenge(verifier), method: "S256" };
}

export function pkceChallenge(verifier: string): string {
  return base64url(createHash("sha256").update(verifier).digest());
}
