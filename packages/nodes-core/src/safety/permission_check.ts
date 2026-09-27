import { z } from "zod";
import { defineNode, ok } from "@flowaid/node-sdk";
import { BadRequestError } from "@flowaid/workflow-core";

/** Whether a granted scope covers a required capability (`refunds:*` covers `refunds:write`, `*` covers all). */
export function scopeCovers(granted: string, required: string): boolean {
  if (granted === "*" || granted === required) return true;
  if (granted.endsWith(":*")) return required.startsWith(granted.slice(0, -1));
  return false;
}

/** Scopes from a list, a comma/space separated string, or a credential's `scopes` field. */
export function parseScopes(value: unknown): string[] {
  if (Array.isArray(value))
    return value
      .filter((v): v is string => typeof v === "string")
      .map((s) => s.trim())
      .filter(Boolean);
  if (typeof value === "string") return value.split(/[\s,]+/).filter(Boolean);
  return [];
}

export const permissionCheckNode = defineNode({
  id: "flowaid.safety.permission_check",
  version: "1.0.0",
  metadata: {
    name: "Permission check",
    description:
      "Checks that the required capabilities are covered by the scopes of a bound credential or of the caller (`scopes` input). Fires `granted` or `denied`.",
    category: "safety",
    icon: "key-round",
    tags: ["safety", "permissions", "authorization"],
    summary: "{{ config.require }}",
  },
  configSchema: z.strictObject({
    require: z
      .array(z.string().regex(/^(\*|[a-z][a-z0-9_.-]*(:[a-z0-9_.*-]+)*)$/))
      .min(1)
      .max(50)
      .meta({
        "x-ui": {
          help: "Capabilities such as refunds:write; a granted scope refunds:* covers every refunds capability.",
        },
      }),
    mode: z
      .enum(["all", "any"])
      .default("all")
      .meta({ "x-ui": { widget: "select" } }),
  }),
  inputSchema: z.object({
    scopes: z
      .union([z.array(z.string()), z.string()])
      .optional()
      .meta({
        "x-port": { description: "The caller's scopes; used when no subject credential is bound." },
      }),
  }),
  outputSchema: z.object({
    granted: z.boolean(),
    missing: z.array(z.string()),
    scopes: z.array(z.string()),
  }),
  controlPorts: [
    { name: "granted", label: "Granted" },
    { name: "denied", label: "Denied" },
  ],
  credentials: [
    {
      name: "subject",
      types: ["oauth2.client_credentials", "github.token", "http.bearer", "mcp.oauth"],
      required: false,
      description: "A credential whose `scopes` field lists what it may do.",
    },
  ],
  capabilities: ["credentials"],
  idempotency: "safe",
  defaultPolicy: { timeoutMs: 5000 },
  execute: async (ctx, input) => {
    let scopes: string[];
    if (ctx.credentials.has("subject"))
      scopes = parseScopes((await ctx.credentials.get("subject")).scopes);
    else if (input.scopes !== undefined) scopes = parseScopes(input.scopes);
    else throw new BadRequestError("bind a subject credential or the scopes input");
    const covered = (cap: string) => scopes.some((s) => scopeCovers(s, cap));
    const missing = ctx.config.require.filter((c) => !covered(c));
    const granted =
      ctx.config.mode === "all" ? missing.length === 0 : missing.length < ctx.config.require.length;
    return ok(
      { granted, missing: granted ? [] : missing, scopes },
      { route: granted ? "granted" : "denied" },
    );
  },
});
