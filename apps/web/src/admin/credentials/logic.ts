/**
 * The New credential flow's draft and checks (pure, so it is unit tested). Secret values live in
 * the draft only in memory: `keptDraft` strips them before anything is written to the browser's
 * storage, so a restored draft always asks for its secrets again.
 */
import type { CredentialType, CredentialUse } from "../types";

export const ALL_ENVIRONMENTS = "__all";

export interface CredentialDraft {
  typeId: string;
  name: string;
  storage: "db" | "external";
  externalRef: string;
  /** ALL_ENVIRONMENTS or an environment id */
  env: string;
  /** null: every workflow may bind it */
  allowedWorkflowIds: string[] | null;
  /** field name → value; secret fields never reach storage */
  values: Record<string, string>;
  testAfter: boolean;
}

export const emptyCredentialDraft = (typeId = ""): CredentialDraft => ({
  typeId,
  name: "",
  storage: "db",
  externalRef: "",
  env: ALL_ENVIRONMENTS,
  allowedWorkflowIds: null,
  values: {},
  testAfter: true,
});

/** The draft as it may be kept in the browser tab: every secret value removed. */
export function keptDraft(d: CredentialDraft, types: readonly CredentialType[]): CredentialDraft {
  const type = types.find((t) => t.id === d.typeId);
  const values = type
    ? Object.fromEntries(
        Object.entries(d.values).filter(
          ([k]) => type.fields.find((f) => f.name === k)?.secret === false,
        ),
      )
    : {};
  return { ...d, values };
}

/** What a credential type is for, to group the type choice. */
export type ServiceGroup = "models" | "tools" | "http";

export const SERVICE_GROUP_LABEL: Record<ServiceGroup, string> = {
  models: "AI model providers",
  tools: "Tools, code and data",
  http: "Any HTTP API",
};

export function serviceGroup(typeId: string): ServiceGroup {
  const [prefix] = typeId.split(".");
  if (
    ["typesafe", "openai", "anthropic", "google", "cohere", "jina", "ollama"].includes(prefix ?? "")
  )
    return "models";
  if (prefix === "http" || prefix === "oauth2") return "http";
  return "tools";
}

/** Model provider whose server key (TYPESAFE_API_KEY, OPENAI_API_KEY, …) can stand in for this type. */
export function serverKeyProvider(typeId: string): string | undefined {
  if (typeId === "ollama.host" || typeId === "ollama.none") return "ollama";
  const [provider, kind] = typeId.split(".");
  return kind === "api_key" && ["typesafe", "openai", "anthropic"].includes(provider ?? "")
    ? provider
    : undefined;
}

const REF_SCHEMES = ["env:", "vault:", "aws-sm:", "azure-kv:", "gcp-sm:"];

/**
 * A first check of an external reference, before the server's full one: a known scheme and, for
 * `env:`, the only names the server reads (FLOWAID_SECRET_…).
 */
export function externalRefProblem(ref: string): string | undefined {
  const r = ref.trim();
  if (!r) return "Enter the reference";
  const scheme = REF_SCHEMES.find((s) => r.startsWith(s));
  if (!scheme) return "Start with env:, vault:, aws-sm:, azure-kv: or gcp-sm:";
  if (r.startsWith("vault://") || r.startsWith("aws-sm://"))
    return "No // after the scheme: vault:secret/data/openai#apiKey";
  if (scheme === "env:" && !/^env:FLOWAID_SECRET_[A-Z0-9_]+$/.test(r))
    return "env: references name a variable starting FLOWAID_SECRET_ (capitals, digits and _)";
  if (scheme === "vault:" && !r.includes("#")) return "Name the key after #: vault:<path>#<key>";
  return undefined;
}

export interface CredentialCheck {
  id: string;
  state: "blocker" | "warning" | "info" | "ok";
  message: string;
  /** the step that fixes it */
  step?: "service" | "secret" | "scope";
}

export interface CredentialContext {
  type: CredentialType | undefined;
  /** the server has this model provider's key in its environment */
  serverHasKey: (provider: string) => boolean;
  /** names of the credentials already in the workspace */
  existingNames: readonly string[];
  /** the environment's name, for messages */
  envName: (id: string) => string;
  canUseExternal: boolean;
}

/** Everything the review step lists: what stops the create, and what is worth knowing first. */
export function credentialChecks(d: CredentialDraft, ctx: CredentialContext): CredentialCheck[] {
  const out: CredentialCheck[] = [];
  const { type } = ctx;
  if (!type) {
    out.push({ id: "type", state: "blocker", message: "Choose the service", step: "service" });
    return out;
  }
  const name = d.name.trim();
  if (!name) out.push({ id: "name", state: "blocker", message: "Give it a name", step: "secret" });
  else if (ctx.existingNames.includes(name))
    out.push({
      id: "name",
      state: "blocker",
      message: `A credential named ${name} already exists: choose another name`,
      step: "secret",
    });
  if (d.storage === "external") {
    if (!ctx.canUseExternal)
      out.push({
        id: "external",
        state: "blocker",
        message: "Only admins can store references to an external secret manager",
        step: "secret",
      });
    const problem = externalRefProblem(d.externalRef);
    if (problem) out.push({ id: "ref", state: "blocker", message: problem, step: "secret" });
    else
      out.push({
        id: "ref-read",
        state: "info",
        message:
          "FlowAId reads the value when a run needs it; the server must be configured to reach that secret manager.",
      });
  } else {
    const missing = type.fields.filter((f) => f.required && !d.values[f.name]?.trim());
    if (missing.length)
      out.push({
        id: "fields",
        state: "blocker",
        message: `Fill in ${missing.map((f) => f.name).join(", ")}`,
        step: "secret",
      });
  }
  if (d.allowedWorkflowIds !== null && d.allowedWorkflowIds.length === 0)
    out.push({
      id: "workflows",
      state: "blocker",
      message: "Choose at least one workflow, or allow every workflow",
      step: "scope",
    });
  if (!out.some((c) => c.state === "blocker"))
    out.push({ id: "valid", state: "ok", message: "Everything the credential needs is filled in" });

  const provider = serverKeyProvider(type.id);
  if (provider && ctx.serverHasKey(provider))
    out.push({
      id: "server-key",
      state: "info",
      message:
        "The server already has a key for this service. Steps whose secret is optional use it when no credential is bound; a bound credential takes its place.",
    });
  if (d.env !== ALL_ENVIRONMENTS)
    out.push({
      id: "env",
      state: "info",
      message: `Only ${ctx.envName(d.env)} can use it: bindings in other environments will not resolve.`,
    });
  if (d.storage === "db" && d.testAfter && type.testSupported)
    out.push({
      id: "test",
      state: "info",
      message:
        "After creating it, FlowAId sends one request to the service to check that it accepts the key.",
    });
  else if (!type.testSupported || d.storage === "external")
    out.push({
      id: "no-test",
      state: "info",
      message:
        "This credential cannot be tested here: the first run that uses it shows whether it works.",
    });
  return out;
}

/** The API request for a draft that passes its checks. */
export function credentialBody(d: CredentialDraft): Record<string, unknown> {
  const values = Object.fromEntries(Object.entries(d.values).filter(([, v]) => v.trim() !== ""));
  return {
    name: d.name.trim(),
    type: d.typeId,
    storage: d.storage,
    ...(d.storage === "db" ? { values } : { externalRef: d.externalRef.trim() }),
    environmentId: d.env === ALL_ENVIRONMENTS ? null : d.env,
    ...(d.allowedWorkflowIds !== null ? { allowedWorkflowIds: d.allowedWorkflowIds } : {}),
  };
}

const USE_KIND: Record<CredentialUse["kind"], string> = {
  workflow_secret: "Workflow secret",
  toolset: "OpenAPI toolset",
  mcp_server: "MCP server",
  knowledge_source: "Knowledge source",
  webhook: "Webhook signing secret",
  notification: "Notification channel",
};

/** What a use is, and where to change it. */
export function describeUse(ws: string, u: CredentialUse): { kind: string; href: string } {
  const href =
    u.kind === "workflow_secret"
      ? `/${ws}/workflows/${u.id}/settings`
      : u.kind === "toolset"
        ? `/${ws}/integrations?tab=openapi`
        : u.kind === "mcp_server"
          ? `/${ws}/integrations?tab=mcp`
          : u.kind === "knowledge_source"
            ? `/${ws}/knowledge/${u.id}`
            : u.kind === "webhook"
              ? `/${ws}/triggers?tab=webhooks`
              : `/${ws}/settings?tab=notifications`;
  return { kind: USE_KIND[u.kind], href };
}

/** What deleting a credential that is still used does to each kind of use. */
export const UNBIND_EFFECTS =
  "Workflow secrets are unbound (their runs fail with “secret not bound” until another credential is bound), MCP servers, OpenAPI toolsets and knowledge sources lose their authentication, and webhooks refuse calls until they get a new secret.";
