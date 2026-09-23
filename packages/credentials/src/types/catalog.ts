/**
 * The credential type catalog (WP-06). Each type declares its fields as a Zod object; fields
 * marked `.meta({ "x-secret": true })` are encrypted and redacted, the others are also shown as
 * `publicFields`. `test()` probes a credential against its service (POST /v1/credentials/:id/test,
 * run in the worker) and never throws: it reports `{ ok, message }`.
 */
import { z } from "zod";
import type { SafeFetch } from "@flowaid/workflow-core";

export interface CredentialType {
  id: string;
  name: string;
  description: string;
  schema: z.ZodObject;
  /** Tool capability scopes this type may grant (checked against ToolDefinition.capability). */
  scopes?: readonly string[];
  test?: (
    value: Record<string, string>,
    http: SafeFetch,
    signal: AbortSignal,
  ) => Promise<{ ok: boolean; message?: string }>;
}

const secret = () => z.string().min(1).meta({ "x-secret": true });
const url = () => z.url();

/** Whether a field is marked secret, looking through `.optional()`, `.default()` and `.nullable()`. */
function isSecret(schema: z.ZodType): boolean {
  let current: z.ZodType | undefined = schema;
  for (let depth = 0; current && depth < 8; depth += 1) {
    if (z.globalRegistry.get(current)?.["x-secret"] === true) return true;
    const wrapper = current as { unwrap?: () => z.ZodType };
    current = typeof wrapper.unwrap === "function" ? wrapper.unwrap() : undefined;
  }
  return false;
}

/** Secret field names of a type (from `.meta({ "x-secret": true })`, also on optional fields). */
export function secretFields(type: CredentialType): string[] {
  return Object.entries(type.schema.shape)
    .filter(([, field]) => isSecret(field as z.ZodType))
    .map(([name]) => name);
}

/** GET a URL and translate the status into a probe result. */
async function probe(
  http: SafeFetch,
  signal: AbortSignal,
  target: string,
  headers: Record<string, string>,
  service: string,
): Promise<{ ok: boolean; message?: string }> {
  try {
    const response = await http(target, { method: "GET", headers, signal });
    if (response.ok) return { ok: true };
    if (response.status === 401 || response.status === 403)
      return { ok: false, message: `${service} rejected the credential (${response.status})` };
    return { ok: false, message: `${service} answered ${response.status}` };
  } catch (error) {
    return {
      ok: false,
      message: `${service} could not be reached: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

export const CREDENTIAL_TYPES: readonly CredentialType[] = [
  {
    id: "typesafe.api_key",
    name: "TypeSafe API key",
    description: "Key for TypeSafe's Jev decision API.",
    schema: z.strictObject({ apiKey: secret(), baseUrl: url().optional() }),
    test: (v, http, signal) =>
      probe(
        http,
        signal,
        `${v.baseUrl ?? "https://api.typesafe.ai"}/v1/models`,
        bearer(v.apiKey ?? ""),
        "TypeSafe",
      ),
  },
  {
    id: "openai.api_key",
    name: "OpenAI API key",
    description: "Key for OpenAI or an OpenAI-compatible endpoint (set baseUrl for the latter).",
    schema: z.strictObject({
      apiKey: secret(),
      organization: z.string().optional(),
      baseUrl: url().optional(),
    }),
    test: (v, http, signal) =>
      probe(
        http,
        signal,
        `${v.baseUrl ?? "https://api.openai.com/v1"}/models`,
        bearer(v.apiKey ?? ""),
        "OpenAI",
      ),
  },
  {
    id: "anthropic.api_key",
    name: "Anthropic API key",
    description: "Key for the Claude API.",
    schema: z.strictObject({ apiKey: secret() }),
    test: (v, http, signal) =>
      probe(
        http,
        signal,
        "https://api.anthropic.com/v1/models",
        { "x-api-key": v.apiKey ?? "", "anthropic-version": "2023-06-01" },
        "Anthropic",
      ),
  },
  {
    id: "google.api_key",
    name: "Google Gemini API key",
    description: "Key for the Gemini API.",
    schema: z.strictObject({ apiKey: secret() }),
    test: (v, http, signal) =>
      probe(
        http,
        signal,
        "https://generativelanguage.googleapis.com/v1beta/models",
        { "x-goog-api-key": v.apiKey ?? "" },
        "Google",
      ),
  },
  {
    id: "ollama.host",
    name: "Ollama server",
    description:
      "Address of an Ollama server, with an optional bearer token for a protected proxy.",
    schema: z.strictObject({ host: url(), token: secret().optional() }),
    test: (v, http, signal) =>
      probe(
        http,
        signal,
        `${(v.host ?? "").replace(/\/+$/, "")}/api/tags`,
        v.token ? bearer(v.token) : {},
        "Ollama",
      ),
  },
  {
    id: "ollama.none",
    name: "Ollama (no credential)",
    description: "A local Ollama server that needs no credential.",
    schema: z.strictObject({}),
  },
  {
    id: "http.bearer",
    name: "Bearer token",
    description: "Sent as `Authorization: Bearer <token>`.",
    schema: z.strictObject({ token: secret() }),
  },
  {
    id: "http.basic",
    name: "Basic authentication",
    description: "Sent as `Authorization: Basic base64(username:password)`.",
    schema: z.strictObject({ username: z.string().min(1), password: secret() }),
  },
  {
    id: "http.api_key",
    name: "API key",
    description: "Sent in a header (default `X-API-Key`) or a query parameter.",
    schema: z.strictObject({
      key: secret(),
      in: z.enum(["header", "query"]).default("header"),
      name: z.string().min(1).default("X-API-Key"),
    }),
  },
  {
    id: "http.header",
    name: "Custom header",
    description: "Any header, e.g. a vendor-specific token.",
    schema: z.strictObject({ name: z.string().min(1), value: secret() }),
  },
  {
    id: "oauth2.client_credentials",
    name: "OAuth 2.0 client credentials",
    description: "Exchanged for an access token with the client-credentials grant.",
    schema: z.strictObject({
      tokenUrl: url(),
      clientId: z.string().min(1),
      clientSecret: secret(),
      scope: z.string().optional(),
      audience: z.string().optional(),
    }),
    test: async (v, http, signal) => {
      const body = new URLSearchParams({
        grant_type: "client_credentials",
        ...(v.scope ? { scope: v.scope } : {}),
        ...(v.audience ? { audience: v.audience } : {}),
      });
      try {
        const response = await http(v.tokenUrl ?? "", {
          method: "POST",
          headers: {
            "content-type": "application/x-www-form-urlencoded",
            authorization: `Basic ${Buffer.from(`${v.clientId ?? ""}:${v.clientSecret ?? ""}`).toString("base64")}`,
          },
          body: body.toString(),
          signal,
        });
        if (!response.ok)
          return { ok: false, message: `The token endpoint answered ${response.status}` };
        const json = (await response.json()) as { access_token?: unknown };
        return typeof json.access_token === "string"
          ? { ok: true }
          : { ok: false, message: "The token endpoint returned no access_token" };
      } catch (error) {
        return {
          ok: false,
          message: `The token endpoint could not be reached: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    },
  },
  {
    id: "mcp.headers",
    name: "MCP server headers",
    description: "Headers sent to an MCP server (JSON object of name → value).",
    schema: z.strictObject({ headers: secret() }),
  },
  {
    id: "mcp.oauth",
    name: "MCP OAuth token",
    description: "OAuth 2.1 tokens obtained for an MCP server; refreshed by the worker.",
    schema: z.strictObject({
      accessToken: secret(),
      refreshToken: secret().optional(),
      expiresAt: z.iso.datetime().optional(),
      tokenUrl: url().optional(),
      clientId: z.string().optional(),
    }),
  },
  {
    id: "github.token",
    name: "GitHub token",
    description:
      "A fine-grained or classic personal access token, or a GitHub App installation token.",
    schema: z.strictObject({ token: secret() }),
    scopes: ["github.read", "github.write"],
    test: (v, http, signal) =>
      probe(
        http,
        signal,
        "https://api.github.com/user",
        { ...bearer(v.token ?? ""), "user-agent": "flowaid" },
        "GitHub",
      ),
  },
  {
    id: "aws.iam",
    name: "AWS access key",
    description: "IAM access key pair (with an optional session token).",
    schema: z.strictObject({
      accessKeyId: z.string().min(16),
      secretAccessKey: secret(),
      sessionToken: secret().optional(),
      region: z.string().min(1),
    }),
  },
  {
    id: "postgres.dsn",
    name: "PostgreSQL connection",
    description: "A postgres:// connection string (tested by the worker with its database driver).",
    schema: z.strictObject({ dsn: secret() }),
  },
];

export class CredentialTypeCatalog {
  private readonly byId: Map<string, CredentialType>;

  constructor(types: readonly CredentialType[] = CREDENTIAL_TYPES) {
    this.byId = new Map(types.map((t) => [t.id, t]));
  }

  get(id: string): CredentialType | undefined {
    return this.byId.get(id);
  }

  list(): CredentialType[] {
    return [...this.byId.values()];
  }

  /** Registers a plugin's credential type (NodePackage.credentialTypes). */
  register(type: CredentialType): void {
    if (this.byId.has(type.id))
      throw new Error(`Credential type '${type.id}' is already registered`);
    this.byId.set(type.id, type);
  }
}
