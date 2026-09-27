/** Agent presets (`/v1/agents`): the form's draft ⇄ the preset config the API stores. */

export type ApprovalMode = "always" | "irreversible" | "never";

export interface AgentPreset {
  id: string;
  name: string;
  description: string;
  config: Record<string, unknown>;
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
}

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
});

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
  };
}

export interface DraftCheck {
  ok: boolean;
  errors: Partial<Record<keyof AgentDraft, string>>;
  body?: { name: string; description: string; config: Record<string, unknown> };
}

function num(
  raw: string,
  field: "maxSteps" | "maxToolCalls" | "maxCostUsd",
  errors: DraftCheck["errors"],
): number | undefined {
  if (!raw.trim()) return undefined;
  const n = Number(raw);
  const integer = field !== "maxCostUsd";
  const [min, max] =
    field === "maxSteps" ? [1, 50] : field === "maxToolCalls" ? [0, 200] : [0, Infinity];
  if (!Number.isFinite(n) || (integer && !Number.isInteger(n)) || n < min || n > max) {
    errors[field] =
      field === "maxCostUsd" ? "A cost in USD, 0 or more" : `A whole number from ${min} to ${max}`;
    return undefined;
  }
  return n;
}

/** Validates the draft and builds the request body (only the settings that are set). */
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
        model: d.model,
        ...(d.system.trim() ? { system: d.system.trim() } : {}),
        tools: d.tools,
        ...(maxSteps !== undefined ? { maxSteps } : {}),
        ...(maxToolCalls !== undefined ? { maxToolCalls } : {}),
        ...(maxCostUsd !== undefined ? { maxCostUsd } : {}),
      },
    },
  };
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
