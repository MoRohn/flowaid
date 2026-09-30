/**
 * What the Integrations dialogs check before saving (MCP servers, tool policies, OpenAPI imports)
 * and the Integrations page's "What you need", from real state. Pure, so it is unit tested.
 */

export interface Note {
  id: string;
  state: "blocker" | "warning" | "info" | "ok";
  message: string;
}

/**
 * The server's literal private-address rule (openapi-tools `isPrivateAddress`): loopback,
 * RFC 1918, link-local, unique-local, `.local`/`.internal`/`.lan` names and dotless hosts. The API
 * refuses these unless FLOWAID_ALLOW_PRIVATE_NETWORK is on.
 */
export function isPrivateUrl(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  const host = u.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  const v4 = /^(\d+)\.(\d+)\.\d+\.\d+$/.exec(host);
  if (v4) {
    const a = Number(v4[1]);
    const b = Number(v4[2]);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224
    );
  }
  if (host.includes(":"))
    return host === "::1" || host === "::" || /^(?:fc|fd|fe[89ab])/.test(host);
  return (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host.endsWith(".lan") ||
    !host.includes(".")
  );
}

const PRIVATE_NOTE =
  "is on this computer or your private network. FlowAId reaches such addresses only when the api and worker run with FLOWAID_ALLOW_PRIVATE_NETWORK=true; otherwise the call is refused.";

export interface McpServerDraft {
  name: string;
  transport: "streamable_http" | "sse" | "stdio";
  url: string;
  command: string;
  args: string;
  authKind: "none" | "headers" | "oauth2";
  credentialId: string;
}

export const emptyServer = (): McpServerDraft => ({
  name: "",
  transport: "streamable_http",
  url: "",
  command: "",
  args: "",
  authKind: "none",
  credentialId: "",
});

/** Field → problem (empty when the server can be saved). */
export function serverProblems(d: McpServerDraft): Partial<Record<keyof McpServerDraft, string>> {
  const out: Partial<Record<keyof McpServerDraft, string>> = {};
  if (!d.name.trim()) out.name = "Give the server a name";
  if (d.transport === "stdio") {
    if (!d.command.trim()) out.command = "Enter the command to start";
    else if (!/^(\/|[A-Za-z]:\\)/.test(d.command.trim()))
      out.command = "Use the full path of the executable, such as /usr/local/bin/mcp-files";
  } else if (!/^https?:\/\/\S+$/.test(d.url.trim())) out.url = "Enter the server's http(s) address";
  if (d.authKind !== "none" && !d.credentialId) out.credentialId = "Choose the credential to send";
  return out;
}

/** The request body for `POST /v1/mcp/servers`. */
export function serverBody(d: McpServerDraft): Record<string, unknown> {
  return {
    name: d.name.trim(),
    transport: d.transport,
    ...(d.transport === "stdio"
      ? {
          command: d.command.trim(),
          args: d.args
            .split("\n")
            .map((a) => a.trim())
            .filter(Boolean),
        }
      : { url: d.url.trim() }),
    authKind: d.authKind,
    credentialId: d.authKind === "none" || !d.credentialId ? null : d.credentialId,
  };
}

/** What to know before connecting, beyond the form's own errors. */
export function serverNotes(d: McpServerDraft, ctx: { admin: boolean }): Note[] {
  const notes: Note[] = [];
  if (d.transport === "stdio") {
    notes.push({
      id: "stdio",
      state: ctx.admin ? "info" : "blocker",
      message: ctx.admin
        ? "A stdio server is a program the worker starts on this computer. The server must run with MCP_STDIO_ENABLED=true and list the command in FLOWAID_MCP_STDIO_ALLOWED_COMMANDS, or saving is refused. Test and Discover work only for HTTP servers."
        : "Only workspace admins can add stdio servers. Use Streamable HTTP, or ask an admin.",
    });
    return notes;
  }
  const url = d.url.trim();
  if (/^https?:\/\//.test(url)) {
    if (isPrivateUrl(url))
      notes.push({ id: "private", state: "warning", message: `This address ${PRIVATE_NOTE}` });
    else if (url.startsWith("http://"))
      notes.push({
        id: "plain-http",
        state: "warning",
        message: "Plain http: requests and any headers you send travel unencrypted.",
      });
  }
  if (d.transport === "sse")
    notes.push({
      id: "sse",
      state: "info",
      message:
        "SSE is the older MCP transport. Use Streamable HTTP unless the server only offers SSE.",
    });
  if (d.authKind === "none")
    notes.push({
      id: "no-auth",
      state: "info",
      message:
        "No credential: fine for public or local servers; a server that needs a key answers 401 when tested.",
    });
  return notes;
}

// ── tool policy ─────────────────────────────────────────────────────────────────────────────

export interface ToolPolicy {
  allow: string[];
  deny: string[];
  approvalRequired: string[];
}

/** One glob per line or comma → a clean list. */
export function parseGlobs(text: string): string[] {
  return [
    ...new Set(
      text
        .split(/[\n,]+/)
        .map((x) => x.trim())
        .filter(Boolean),
    ),
  ];
}

/** Same rule as the server (`@flowaid/mcp` globToRegExp): `*` any run, `?` one character. */
function globToRegExp(glob: string): RegExp {
  let re = "";
  for (const ch of glob) {
    if (ch === "*") re += ".*";
    else if (ch === "?") re += ".";
    else re += ch.replace(/[.+^${}()|[\]\\/]/g, "\\$&");
  }
  return new RegExp(`^${re}$`, "s");
}
const matches = (globs: readonly string[], name: string) =>
  globs.some((g) => globToRegExp(g).test(name));

/** How the policy treats each known tool name: deny wins, an empty allow list allows all. */
export function policyPreview(
  policy: ToolPolicy,
  names: readonly string[],
): { name: string; verdict: "allowed" | "approval" | "blocked" }[] {
  return names.map((name) => ({
    name,
    verdict:
      matches(policy.deny, name) || (policy.allow.length > 0 && !matches(policy.allow, name))
        ? "blocked"
        : matches(policy.approvalRequired, name)
          ? "approval"
          : "allowed",
  }));
}

// ── OpenAPI import ──────────────────────────────────────────────────────────────────────────

const CHANGES = new Set(["post", "put", "patch", "delete"]);

/** What to know before importing the chosen operations. */
export function importNotes(i: {
  authSchemes: Record<string, unknown>;
  credentialId: string;
  serverUrl: string;
  operations: readonly { name: string; method?: string }[];
  include: readonly string[];
  /** toolsets already in the workspace */
  taken: readonly string[];
  name: string;
}): Note[] {
  const notes: Note[] = [];
  if (!i.name.trim())
    notes.push({ id: "name", state: "blocker", message: "Give the toolset a name" });
  else if (i.taken.includes(i.name.trim()))
    notes.push({
      id: "name",
      state: "blocker",
      message: `A toolset named ${i.name.trim()} exists: choose another name, or delete that one first.`,
    });
  if (i.include.length === 0)
    notes.push({ id: "ops", state: "blocker", message: "Choose at least one operation" });
  const schemes = Object.keys(i.authSchemes);
  if (schemes.length && !i.credentialId)
    notes.push({
      id: "auth",
      state: "warning",
      message: `The API declares ${schemes.join(", ")} authentication but no credential is chosen: calls will likely be refused.`,
    });
  if (!i.serverUrl.trim())
    notes.push({
      id: "server",
      state: "warning",
      message:
        "The document names no server: enter the API's base address, or calls have nowhere to go.",
    });
  else if (!/^https?:\/\/\S+$/.test(i.serverUrl.trim()))
    notes.push({
      id: "server",
      state: "warning",
      message: "The server is not a full http(s) address; calls may not reach it.",
    });
  else if (isPrivateUrl(i.serverUrl))
    notes.push({ id: "private", state: "warning", message: `The server ${PRIVATE_NOTE}` });
  const chosen = new Set(i.include);
  const changing = i.operations.filter(
    (o) => chosen.has(o.name) && CHANGES.has((o.method ?? "").toLowerCase()),
  ).length;
  if (changing)
    notes.push({
      id: "changes",
      state: "info",
      message: `${changing} of the chosen operations can change data (POST, PUT, PATCH or DELETE). Import only those the workflows need; agents can be set to ask before calling them.`,
    });
  return notes;
}

/** `Acme Orders API` → `acme-orders-api`, the suggested toolset name. */
export function toolsetName(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60) || "api"
  );
}

// ── the Integrations page ───────────────────────────────────────────────────────────────────

export interface PageCheck {
  id: string;
  state: "ok" | "blocker" | "warning" | "info" | "optional" | "checking";
  label: string;
  detail?: string;
}

/** "What you need" on the MCP, OpenAPI and Plugins tabs, from what each tab loaded. */
export function integrationPageChecks(
  tab: "mcp" | "openapi" | "plugins",
  i: {
    servers?: readonly { status: string; toolCount: number; transport: string }[];
    toolsets?: readonly { kind: string; definitions: readonly unknown[] }[];
    plugins?: readonly { status: string; source: string }[];
    can: (scope: string) => boolean;
  },
): PageCheck[] {
  const out: PageCheck[] = [];
  if (tab === "mcp") {
    const s = i.servers;
    if (!s) out.push({ id: "servers", state: "checking", label: "MCP servers" });
    else if (s.length === 0)
      out.push({
        id: "servers",
        state: "optional",
        label: "No MCP server connected",
        detail: "Connect one to give MCP steps and agents its tools.",
      });
    else {
      const broken = s.filter((x) => x.status === "error").length;
      const undiscovered = s.filter(
        (x) =>
          x.transport !== "stdio" &&
          x.status !== "error" &&
          x.status !== "disabled" &&
          x.toolCount === 0,
      ).length;
      const tools = s.reduce((n, x) => n + x.toolCount, 0);
      if (broken)
        out.push({
          id: "broken",
          state: "warning",
          label: `${broken} server${broken === 1 ? "" : "s"} failed the last check`,
          detail: "The red line in the Status column says why; test again after fixing it.",
        });
      if (undiscovered)
        out.push({
          id: "undiscovered",
          state: "warning",
          label: `${undiscovered} server${undiscovered === 1 ? " has" : "s have"} no discovered tools`,
          detail: "Press Discover tools on the row: only discovered tools can be used.",
        });
      if (tools)
        out.push({
          id: "tools",
          state: "ok",
          label: `${tools} tool${tools === 1 ? "" : "s"} from ${s.length} server${s.length === 1 ? "" : "s"}`,
        });
    }
    if (!i.can("mcp:write"))
      out.push({
        id: "role",
        state: "info",
        label: "Your role can view servers but not connect or change them",
      });
  } else if (tab === "openapi") {
    const t = i.toolsets?.filter((x) => x.kind === "openapi");
    if (!t) out.push({ id: "toolsets", state: "checking", label: "OpenAPI toolsets" });
    else if (t.length === 0)
      out.push({
        id: "toolsets",
        state: "optional",
        label: "No OpenAPI toolset imported",
        detail: "Import a document to give OpenAPI steps and agents its operations.",
      });
    else {
      const ops = t.reduce((n, x) => n + x.definitions.length, 0);
      out.push({
        id: "toolsets",
        state: "ok",
        label: `${ops} operation${ops === 1 ? "" : "s"} from ${t.length} toolset${t.length === 1 ? "" : "s"}`,
      });
    }
    if (!i.can("tools:write"))
      out.push({
        id: "role",
        state: "info",
        label: "Your role can view toolsets but not import or delete them",
      });
  } else {
    const p = i.plugins;
    if (!p) out.push({ id: "plugins", state: "checking", label: "Node packages" });
    else {
      const failed = p.filter((x) => x.status === "error").length;
      out.push(
        failed
          ? {
              id: "plugins",
              state: "warning",
              label: `${failed} package${failed === 1 ? "" : "s"} failed to load`,
              detail: "The Status column shows the error.",
            }
          : {
              id: "plugins",
              state: "ok",
              label: `${p.filter((x) => x.status === "enabled").length} of ${p.length} packages enabled`,
            },
      );
    }
    if (!i.can("admin"))
      out.push({
        id: "role",
        state: "info",
        label: "Only workspace admins can install, enable or remove packages",
      });
  }
  return out;
}
