/** Agent presets (`/v1/agents`): the form's draft ⇄ the preset config the API stores. */

export type ApprovalMode = "always" | "irreversible" | "never";
/** Streaming as the form sets it: unset (the Agent step's default, off), or on/off explicitly. */
export type StreamMode = "default" | "on" | "off";

export interface AgentPreset {
  id: string;
  name: string;
  description: string;
  config: Record<string, unknown>;
  /** offered as its own step in the builder's Add node; older servers leave it out (active) */
  active?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AgentDraft {
  name: string;
  description: string;
  model: unknown;
  system: string;
  tools: { name: string; approval: ApprovalMode }[];
  maxSteps: string;
  maxToolCalls: string;
  maxCostUsd: string;
  /** the "Advanced" limits: sampling temperature, output tokens per turn, token cap, streaming */
  temperature: string;
  maxOutputTokens: string;
  maxTokens: string;
  stream: StreamMode;
  /** stored settings the form has no field for, saved back unchanged */
  extra: Record<string, unknown>;
}

/** The config keys the form edits; any other key of a stored config travels in `extra`. */
const FORM_KEYS: ReadonlySet<string> = new Set([
  "model",
  "system",
  "tools",
  "maxSteps",
  "maxToolCalls",
  "maxCostUsd",
  "temperature",
  "maxOutputTokens",
  "maxTokens",
  "stream",
]);

export const APPROVAL_LABEL: Record<ApprovalMode, string> = {
  always: "Always ask",
  irreversible: "Ask for irreversible calls",
  never: "Never ask",
};

export const emptyDraft = (): AgentDraft => ({
  name: "",
  description: "",
  model: undefined,
  system: "",
  tools: [],
  maxSteps: "8",
  maxToolCalls: "16",
  maxCostUsd: "1",
  temperature: "",
  maxOutputTokens: "",
  maxTokens: "",
  stream: "default",
  extra: {},
});

/** Whether any of the "Advanced" limits is set (the form opens that group for them). */
export const hasAdvanced = (d: AgentDraft): boolean =>
  Boolean(d.temperature.trim() || d.maxOutputTokens.trim() || d.maxTokens.trim()) ||
  d.stream !== "default";

/** A stored number or string as form text ("" for anything else). */
const text = (v: unknown): string =>
  typeof v === "number" || typeof v === "string" ? String(v) : "";

/** The preset's bounds for display, with the node's defaults where unset. */
export function boundsOf(config: Record<string, unknown>): {
  maxSteps: number;
  maxToolCalls: number;
  maxCostUsd: number;
} {
  const n = (v: unknown, fallback: number) => (typeof v === "number" ? v : fallback);
  return {
    maxSteps: n(config.maxSteps, 8),
    maxToolCalls: n(config.maxToolCalls, 16),
    maxCostUsd: n(config.maxCostUsd, 1),
  };
}

export function draftOf(p: AgentPreset): AgentDraft {
  const c = p.config;
  const tools = Array.isArray(c.tools)
    ? (c.tools as { name?: unknown; approval?: unknown }[]).flatMap((t) =>
        typeof t.name === "string"
          ? [
              {
                name: t.name,
                approval: (["always", "irreversible", "never"].includes(String(t.approval))
                  ? t.approval
                  : "irreversible") as ApprovalMode,
              },
            ]
          : [],
      )
    : [];
  return {
    name: p.name,
    description: p.description,
    model: c.model,
    system: text(c.system),
    tools,
    maxSteps: text(c.maxSteps),
    maxToolCalls: text(c.maxToolCalls),
    maxCostUsd: text(c.maxCostUsd),
    temperature: text(c.temperature),
    maxOutputTokens: text(c.maxOutputTokens),
    maxTokens: text(c.maxTokens),
    stream: c.stream === true ? "on" : c.stream === false ? "off" : "default",
    extra: Object.fromEntries(Object.entries(c).filter(([k]) => !FORM_KEYS.has(k))),
  };
}

export interface DraftCheck {
  ok: boolean;
  errors: Partial<Record<keyof AgentDraft, string>>;
  body?: { name: string; description: string; config: Record<string, unknown> };
}

type NumberField =
  "maxSteps" | "maxToolCalls" | "maxCostUsd" | "temperature" | "maxOutputTokens" | "maxTokens";

/** Each number's range (the API's, `routes/agents.ts`), whether it is whole, and its error. */
const RANGES: Record<NumberField, { min: number; max: number; integer: boolean; error: string }> = {
  maxSteps: { min: 1, max: 50, integer: true, error: "A whole number from 1 to 50" },
  maxToolCalls: { min: 0, max: 200, integer: true, error: "A whole number from 0 to 200" },
  maxCostUsd: { min: 0, max: Infinity, integer: false, error: "A cost in USD, 0 or more" },
  temperature: { min: 0, max: 2, integer: false, error: "A number from 0 to 2" },
  maxOutputTokens: {
    min: 1,
    max: 65_536,
    integer: true,
    error: "A whole number from 1 to 65536",
  },
  maxTokens: { min: 1, max: Infinity, integer: true, error: "A whole number, 1 or more" },
};

function num(raw: string, field: NumberField, errors: DraftCheck["errors"]): number | undefined {
  if (!raw.trim()) return undefined;
  const n = Number(raw);
  const { min, max, integer, error } = RANGES[field];
  if (!Number.isFinite(n) || (integer && !Number.isInteger(n)) || n < min || n > max) {
    errors[field] = error;
    return undefined;
  }
  return n;
}

/**
 * Validates the draft and builds the request body (only the settings that are set). Saving
 * replaces the stored config as a whole, so settings the form has no field for (`extra`) go back
 * with it unchanged.
 */
export function checkDraft(d: AgentDraft): DraftCheck {
  const errors: DraftCheck["errors"] = {};
  if (!d.name.trim()) errors.name = "Give the agent a name";
  const model = d.model as
    { provider?: unknown; model?: unknown; candidates?: unknown } | undefined;
  const hasModel =
    model !== undefined &&
    ((typeof model.provider === "string" && typeof model.model === "string") ||
      (Array.isArray(model.candidates) && model.candidates.length > 0));
  if (!hasModel) errors.model = "Choose a model";
  const maxSteps = num(d.maxSteps, "maxSteps", errors);
  const maxToolCalls = num(d.maxToolCalls, "maxToolCalls", errors);
  const maxCostUsd = num(d.maxCostUsd, "maxCostUsd", errors);
  const temperature = num(d.temperature, "temperature", errors);
  const maxOutputTokens = num(d.maxOutputTokens, "maxOutputTokens", errors);
  const maxTokens = num(d.maxTokens, "maxTokens", errors);
  const names = d.tools.map((t) => t.name);
  if (new Set(names).size !== names.length) errors.tools = "Each tool can be listed once";
  if (Object.keys(errors).length) return { ok: false, errors };
  return {
    ok: true,
    errors,
    body: {
      name: d.name.trim(),
      description: d.description.trim(),
      config: {
        ...d.extra,
        model: d.model,
        ...(d.system.trim() ? { system: d.system.trim() } : {}),
        tools: d.tools,
        ...(maxSteps !== undefined ? { maxSteps } : {}),
        ...(maxToolCalls !== undefined ? { maxToolCalls } : {}),
        ...(maxCostUsd !== undefined ? { maxCostUsd } : {}),
        ...(temperature !== undefined ? { temperature } : {}),
        ...(maxOutputTokens !== undefined ? { maxOutputTokens } : {}),
        ...(maxTokens !== undefined ? { maxTokens } : {}),
        ...(d.stream !== "default" ? { stream: d.stream === "on" } : {}),
      },
    },
  };
}

/** The "Advanced" settings a config sets, for the review ("" when none is set). */
export function advancedLabel(config: Record<string, unknown>): string {
  const n = (v: unknown) => (typeof v === "number" ? v : undefined);
  const temperature = n(config.temperature);
  const output = n(config.maxOutputTokens);
  const cap = n(config.maxTokens);
  return [
    temperature !== undefined ? `temperature ${temperature}` : "",
    output !== undefined ? `${output} output tokens a turn` : "",
    cap !== undefined ? `${cap} tokens a run` : "",
    typeof config.stream === "boolean" ? `streaming ${config.stream ? "on" : "off"}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

/** "gpt-6-luna", or "cheapest · gpt-6-luna +1" for a failover policy. */
export function modelLabel(model: unknown): string {
  const m = model as
    { model?: string; candidates?: { model?: string }[]; strategy?: string } | undefined;
  if (!m) return "No model";
  if (Array.isArray(m.candidates)) {
    const first = m.candidates[0]?.model ?? "?";
    const more = m.candidates.length - 1;
    return `${m.strategy ?? "ordered"} · ${first}${more > 0 ? ` +${more}` : ""}`;
  }
  return m.model ?? "No model";
}

/** The providers a model setting calls: one, or every candidate of a failover policy. */
export function modelProviders(model: unknown): string[] {
  const m = model as { provider?: unknown; candidates?: { provider?: unknown }[] } | undefined;
  if (!m) return [];
  const list = Array.isArray(m.candidates) ? m.candidates.map((c) => c.provider) : [m.provider];
  return [...new Set(list.filter((p): p is string => typeof p === "string"))];
}

/** Whether the agent node asks before `irreversible` calls to this tool (agent.ts `needsApproval`). */
export function changesData(tool: { approvalRequired?: boolean; idempotency?: unknown }): boolean {
  return tool.approvalRequired === true || tool.idempotency === "none";
}

/**
 * Whether a call to the tool waits for a person: always for `always`, and for `irreversible`
 * only when the tool changes data. `changes` undefined (the catalog not loaded) assumes it does.
 */
export function asksFirst(approval: ApprovalMode, changes: boolean | undefined): boolean {
  return approval === "always" || (approval === "irreversible" && changes !== false);
}

export interface AgentReviewNote {
  id: string;
  state: "blocker" | "warning" | "info";
  message: string;
}

/**
 * The agent's tools that the workspace's tool catalog no longer lists (an MCP server removed or
 * switched off, a tool renamed): the Agent step refuses to run while the agent names one.
 * `available` undefined (the catalog not loaded yet) reports none.
 */
export function missingTools(
  tools: readonly { name: string }[],
  available: ReadonlySet<string> | undefined,
): string[] {
  return available ? tools.map((t) => t.name).filter((n) => !available.has(n)) : [];
}

/** "lookup_order is" / "lookup_order and refund are" */
const nameList = (names: readonly string[]) =>
  names.length === 1
    ? `${names[0]} is`
    : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]} are`;

/**
 * What to know before saving, beyond the form's own errors: tools that are no longer available
 * (a blocker: every run fails), providers without a key (the agent fails when it runs), tools that
 * change data but never ask, and an agent with no tools or no instructions (valid, but probably
 * not what was meant).
 */
export function reviewNotes(
  d: AgentDraft,
  ctx: {
    providerReady: (provider: string) => boolean;
    /** tool name → whether it changes data */
    changes: ReadonlyMap<string, boolean>;
    /** every tool name in the catalog; undefined while it loads */
    available?: ReadonlySet<string>;
  },
): AgentReviewNote[] {
  const notes: AgentReviewNote[] = [];
  const gone = missingTools(d.tools, ctx.available);
  if (gone.length)
    notes.push({
      id: "missing-tools",
      state: "blocker",
      message: `${nameList(gone)} no longer available in this workspace, so every run of the agent would fail. Remove ${gone.length === 1 ? "it" : "them"} under Tools, or reconnect the server or import ${gone.length === 1 ? "it" : "they"} came from.`,
    });
  const missing = modelProviders(d.model).filter((p) => !ctx.providerReady(p));
  if (missing.length)
    notes.push({
      id: "provider-key",
      state: "warning",
      message: `No key for ${missing.join(", ")} in this workspace: the agent can be saved, but its runs fail until a key is added under Credentials.`,
    });
  const unguarded = d.tools.filter((t) => t.approval === "never" && ctx.changes.get(t.name));
  if (unguarded.length)
    notes.push({
      id: "unguarded",
      state: "warning",
      message: `${unguarded.map((t) => t.name).join(", ")} can change data and will run without asking anyone.`,
    });
  // limits of 0 are valid, but stop the agent where it starts (agent.ts checks both before acting)
  if (d.maxCostUsd.trim() !== "" && Number(d.maxCostUsd) === 0)
    notes.push({
      id: "no-spend",
      state: "warning",
      message:
        "Max cost is $0: the agent stops before its first model turn that has a price, so it can only run on a model without one (such as a local Ollama model).",
    });
  if (d.maxToolCalls.trim() !== "" && Number(d.maxToolCalls) === 0 && d.tools.length)
    notes.push({
      id: "no-tool-calls",
      state: "warning",
      message: `Max tool calls is 0 but the agent has ${d.tools.length === 1 ? "a tool" : `${d.tools.length} tools`}: it fails the first time it calls one. Raise the limit, or remove the tools.`,
    });
  if (!d.tools.length)
    notes.push({
      id: "no-tools",
      state: "info",
      message: "No tools: the agent can only write answers from what it is given.",
    });
  if (!d.system.trim())
    notes.push({
      id: "no-instructions",
      state: "info",
      message:
        "No instructions: the agent sees only the step's input. A goal and an answer format usually give steadier results.",
    });
  return notes;
}

/** A starting point for the instructions, meant to be edited. */
export const EXAMPLE_INSTRUCTIONS = `You help customers with questions about their orders.

Goal: answer the customer's question using the tools, not guesses.
- Look up the order before saying anything about its status.
- If a tool fails or the order cannot be found, say so and ask for the order number.
- Never promise a refund; say that a person will review refund requests.

Answer in two or three short sentences, in the customer's language.`;
