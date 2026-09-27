/**
 * Pure logic behind the management surfaces: scope catalogue, JSON input parsing, template and
 * evaluation projections onto @flowaid/ui view types, secret-binding bookkeeping. No React, no
 * fetch; unit-tested in logic.test.ts.
 */
import type {
  EvaluationCaseResultView,
  EvaluationMetricView,
  NodeCategory,
  WorkflowVersionView,
} from "@flowaid/ui";
import type { CalibrationBin, ConfusionPair } from "@flowaid/ui/decision";
import type { WorkflowTemplateView } from "@flowaid/ui/builder";
import type { SecretDecl } from "@flowaid/workflow-core";
import type { VersionSummary } from "~/api/types";
import type {
  CaseResultRow,
  Credential,
  EvaluationCase,
  EvaluationSummary,
  TemplateRow,
} from "./types";

// ── scopes ──────────────────────────────────────────────────────────────────────────────────

/** API.md §1 scopes, grouped by resource for the API-key picker (mirrors apps/api auth/scopes). */
export const SCOPE_GROUPS: readonly { label: string; scopes: readonly string[] }[] = [
  {
    label: "Workflows",
    scopes: ["workflows:read", "workflows:write", "workflows:publish", "workflows:delete"],
  },
  {
    label: "Runs",
    scopes: [
      "runs:create",
      "runs:read",
      "runs:cancel",
      "runs:approve",
      "runs:replay",
      "runs:delete",
    ],
  },
  { label: "Credentials", scopes: ["credentials:read", "credentials:write", "secrets:bind"] },
  { label: "Tools & MCP", scopes: ["tools:read", "tools:write", "mcp:read", "mcp:write"] },
  { label: "Evaluations", scopes: ["evaluations:read", "evaluations:write"] },
  { label: "Triggers", scopes: ["webhooks:write", "schedules:write"] },
  {
    label: "Workspace",
    scopes: ["members:manage", "api_keys:manage", "audit:read", "admin"],
  },
];

/** Ready-made scope sets for common keys. */
export const SCOPE_PRESETS: Record<string, readonly string[]> = {
  "Run workflows": ["workflows:read", "runs:create", "runs:read"],
  "Read only": ["workflows:read", "runs:read", "evaluations:read"],
  "CI / deploy": ["workflows:read", "workflows:write", "workflows:publish", "evaluations:write"],
};

export const ROLES = ["viewer", "operator", "editor", "admin"] as const;
export const ROLE_DESCRIPTION: Record<(typeof ROLES)[number] | "owner", string> = {
  viewer: "Reads workflows, runs and evaluations",
  operator: "Viewer, plus starts, cancels, approves and replays runs",
  editor: "Operator, plus builds, publishes and evaluates workflows",
  admin: "Everything, including credentials, members, keys and audit",
  owner: "Admin who owns the workspace",
};

// ── inputs ──────────────────────────────────────────────────────────────────────────────────

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

/** Parses a JSON editor's text; empty text is `fallback` when given. */
export function parseJsonText<T = unknown>(text: string, fallback?: T): ParseResult<T> {
  if (!text.trim()) {
    return fallback !== undefined
      ? { ok: true, value: fallback }
      : { ok: false, error: "Enter a JSON value" };
  }
  try {
    return { ok: true, value: JSON.parse(text) as T };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Invalid JSON" };
  }
}

/** Parses a JSON object (not an array or scalar). */
export function parseJsonObject(text: string): ParseResult<Record<string, unknown>> {
  const r = parseJsonText<unknown>(text, {});
  if (!r.ok) return r;
  if (typeof r.value !== "object" || r.value === null || Array.isArray(r.value))
    return { ok: false, error: "Expected a JSON object" };
  return { ok: true, value: r.value as Record<string, unknown> };
}

export const pretty = (v: unknown): string => JSON.stringify(v ?? null, null, 2);

/** Comma/space/newline separated tags, de-duplicated and trimmed. */
export function parseTags(text: string): string[] {
  return [
    ...new Set(
      text
        .split(/[\s,]+/)
        .map((t) => t.trim())
        .filter(Boolean),
    ),
  ];
}

/** Environment variable names: `A_B` style, as the API accepts. */
export const VARIABLE_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
export const ENVIRONMENT_NAME = /^[a-z][a-z0-9-]{0,39}$/;
export const TOOL_NAME = /^[A-Za-z0-9_-]{1,64}$/;

/** Variables editor rows ⇄ record; values that parse as JSON keep their type. */
export function rowsToVariables(rows: readonly { key: string; value: string }[]): {
  value: Record<string, unknown>;
  errors: string[];
} {
  const value: Record<string, unknown> = {};
  const errors: string[] = [];
  for (const r of rows) {
    const key = r.key.trim();
    if (!key) continue;
    if (!VARIABLE_NAME.test(key)) errors.push(`${key}: letters, digits and _ only`);
    else if (key in value) errors.push(`${key}: duplicate`);
    else {
      const parsed = parseJsonText(r.value);
      value[key] = parsed.ok && typeof parsed.value !== "string" ? parsed.value : r.value;
    }
  }
  return { value, errors };
}
export function variablesToRows(v: Record<string, unknown>): { key: string; value: string }[] {
  return Object.entries(v).map(([key, val]) => ({
    key,
    value: typeof val === "string" ? val : JSON.stringify(val),
  }));
}

// ── templates ───────────────────────────────────────────────────────────────────────────────

const KIND_CATEGORY: Record<string, NodeCategory> = {
  input: "flow",
  output: "flow",
  branch: "flow",
  join: "flow",
  loop: "flow",
  foreach: "flow",
  subflow: "flow",
  wait: "flow",
  human: "human",
  note: "developer",
};

/** Maps a template row (with `include=graph`) onto the gallery's view, categories from the node catalog. */
export function templateToView(
  t: TemplateRow,
  categoryOfType: (type: string) => NodeCategory | undefined,
): WorkflowTemplateView {
  const nodes = (t.graph?.nodes ?? [])
    .filter((n) => n.kind !== "note")
    .map((n) => ({
      id: n.id,
      name: n.name,
      category:
        (n.type ? categoryOfType(n.type) : undefined) ?? KIND_CATEGORY[n.kind] ?? ("data" as const),
    }));
  const ids = new Set(nodes.map((n) => n.id));
  const categories = [...new Set(nodes.map((n) => n.category))];
  return {
    id: t.id,
    name: t.name,
    description: t.description,
    categories,
    nodes,
    edges: (t.graph?.edges ?? []).filter((e) => ids.has(e.source) && ids.has(e.target)),
    tags: [t.category, ...(t.builtIn ? [] : ["workspace"])],
    decisionCount: nodes.filter((n) => n.category === "decision").length,
  };
}

/** The resources a template needs chosen before it can be instantiated. */
export function templateResourceSlots(t: TemplateRow): {
  key: string;
  kind: "mcpServers" | "knowledgeSources";
  description: string;
  requiredTools: string[];
}[] {
  const r = t.requiredResources ?? {};
  return [
    ...(r.mcpServers ?? []).map((m) => ({
      key: m.key,
      kind: "mcpServers" as const,
      description: m.description ?? "",
      requiredTools: m.requiredTools ?? [],
    })),
    ...(r.knowledgeSources ?? []).map((k) => ({
      key: k.key,
      kind: "knowledgeSources" as const,
      description: k.description ?? "",
      requiredTools: [],
    })),
  ];
}

// ── secrets ─────────────────────────────────────────────────────────────────────────────────

/** Credentials that can fill a declared secret in an environment (type match; env-scoped or global). */
export function credentialsForSecret(
  decl: Pick<SecretDecl, "credentialType">,
  credentials: readonly Credential[],
  environmentId: string,
  workflowId: string,
): Credential[] {
  return credentials.filter(
    (c) =>
      (!decl.credentialType || c.type === decl.credentialType) &&
      (c.environmentId === null || c.environmentId === environmentId) &&
      (c.allowedWorkflowIds === null || c.allowedWorkflowIds.includes(workflowId)),
  );
}

/** Required secrets with no binding: they block a deploy to that environment. */
export function missingRequiredSecrets(
  declared: readonly { name: string; required?: boolean }[],
  bound: Record<string, string>,
): string[] {
  return declared.filter((d) => d.required !== false && !bound[d.name]).map((d) => d.name);
}

// ── versions ────────────────────────────────────────────────────────────────────────────────

export function versionView(
  v: VersionSummary,
  deployedTo: readonly { protected: boolean }[] = [],
  nodeCount = 0,
): WorkflowVersionView {
  return {
    id: v.id,
    version: v.version ?? 0,
    status: deployedTo.some((e) => e.protected)
      ? "production"
      : v.kind === "draft"
        ? "draft"
        : "published",
    createdAt: v.createdAt,
    ...(v.publishedBy ? { createdBy: v.publishedBy } : {}),
    ...(v.notes || v.label ? { message: v.notes ?? v.label ?? "" } : {}),
    nodeCount,
  };
}

// ── evaluations ─────────────────────────────────────────────────────────────────────────────

/** Headline metrics of a summary, with the baseline's values when compared. */
export function summaryMetrics(
  s: EvaluationSummary,
  base?: EvaluationSummary | null,
): EvaluationMetricView[] {
  const m = (
    key: string,
    label: string,
    pick: (x: EvaluationSummary) => number,
    unit: EvaluationMetricView["unit"],
    higherIsBetter: boolean,
  ): EvaluationMetricView => ({
    key,
    label,
    candidate: pick(s),
    ...(base ? { base: pick(base) } : {}),
    unit,
    higherIsBetter,
  });
  const out = [
    m("passRate", "Pass rate", (x) => x.passRate, "ratio", true),
    m("branchCorrectness", "Branch correctness", (x) => x.branchCorrectness, "ratio", true),
    m("schemaSuccess", "Schema success", (x) => x.schemaSuccess, "ratio", true),
    m("toolSuccess", "Tool success", (x) => x.toolSuccess, "ratio", true),
    m("humanReviewRate", "Human review rate", (x) => x.humanReviewRate, "ratio", false),
    m("latencyP95", "Latency p95", (x) => x.latency.p95, "ms", false),
    m("costPerCase", "Cost per case", (x) => x.costUsd.perCase, "usd", false),
  ];
  const nodes = Object.keys(s.accuracy);
  for (const node of nodes)
    out.push(
      m(`accuracy:${node}`, `Accuracy · ${node}`, (x) => x.accuracy[node] ?? 0, "ratio", true),
    );
  return out;
}

/** The evaluation package's bins → the calibration chart's. */
export function toCalibrationBins(
  bins: readonly { lo: number; hi: number; count: number; accuracy: number; confidence: number }[],
): CalibrationBin[] {
  return bins
    .filter((b) => b.count > 0)
    .map((b) => ({
      lower: b.lo,
      upper: b.hi,
      predicted: b.confidence,
      observed: b.accuracy,
      count: b.count,
    }));
}

const label = (v: unknown): string =>
  v === undefined ? "—" : typeof v === "string" ? v : JSON.stringify(v);

/** Expected vs actual decision values per decision node, for confusion matrices. */
export function confusionPairs(
  results: readonly CaseResultRow[],
  cases: readonly EvaluationCase[],
): Record<string, ConfusionPair[]> {
  const byId = new Map(cases.map((c) => [c.id, c]));
  const out: Record<string, ConfusionPair[]> = {};
  for (const r of results) {
    const expected = (byId.get(r.caseId)?.expected.decisions ?? {}) as Record<
      string,
      { value?: unknown }
    >;
    for (const [node, e] of Object.entries(expected)) {
      if (e.value === undefined) continue;
      const actual = r.metrics?.decisions[node]?.value;
      (out[node] ??= []).push({ expected: label(e.value), actual: label(actual) });
    }
  }
  return out;
}

/** A short, stable case name: first string field of the input, else the ordinal. */
export function caseName(c: EvaluationCase | undefined, fallback: string): string {
  if (!c) return fallback;
  const input = c.input;
  if (typeof input === "string") return input.slice(0, 80);
  if (input && typeof input === "object" && !Array.isArray(input)) {
    const first = Object.values(input).find((v) => typeof v === "string");
    if (typeof first === "string") return first.slice(0, 80);
  }
  return `Case ${c.ordinal + 1}`;
}

/** Per-case rows for the report, flagging regressions against a baseline's results. */
export function caseResultViews(
  results: readonly CaseResultRow[],
  cases: readonly EvaluationCase[],
  baseline?: readonly CaseResultRow[] | null,
): EvaluationCaseResultView[] {
  const byId = new Map(cases.map((c) => [c.id, c]));
  const before = new Map((baseline ?? []).map((r) => [r.caseId, r.passed]));
  return results.map((r, i) => {
    const c = byId.get(r.caseId);
    const failed = r.checks.find((k) => !k.passed);
    const branchCheck = r.checks.find((k) => k.kind === "branch");
    return {
      id: r.caseId,
      name: caseName(c, `Case ${i + 1}`),
      passed: r.passed,
      ...(failed ? { expected: failed.expected, actual: failed.actual } : {}),
      ...(branchCheck
        ? {
            branch: {
              ...(branchCheck.expected !== undefined
                ? { expected: label(branchCheck.expected) }
                : {}),
              ...(branchCheck.actual !== undefined ? { actual: label(branchCheck.actual) } : {}),
            },
          }
        : {}),
      ...(r.metrics ? { durationMs: r.metrics.latencyMs, costUsd: r.metrics.costUsd } : {}),
      regression: before.get(r.caseId) === true && !r.passed,
    };
  });
}

/** Badge tone for an evaluation run's status. */
export function runTone(status: string): "ok" | "danger" | "neutral" | "accent" {
  if (status === "completed") return "ok";
  if (status === "failed" || status === "cancelled") return "danger";
  if (status === "running" || status === "queued") return "accent";
  return "neutral";
}

/** A starter expectation for the case editor, filled from a run output when one is given. */
export function expectationTemplate(output?: unknown): Record<string, unknown> {
  return {
    status: "completed",
    output:
      output && typeof output === "object" && !Array.isArray(output)
        ? Object.entries(output as Record<string, unknown>)
            .slice(0, 3)
            .map(([k, v]) => ({ path: `/${k}`, matcher: { type: "equals", value: v } }))
        : [],
    decisions: {},
    branches: {},
  };
}

/** One line describing what a case expects ("status, 2 outputs, 1 decision"). */
export function expectationSummary(e: Record<string, unknown>): string {
  const parts: string[] = [];
  const count = (k: string) => {
    const v = e[k];
    return Array.isArray(v) ? v.length : v && typeof v === "object" ? Object.keys(v).length : 0;
  };
  if (typeof e.status === "string") parts.push(`status ${e.status}`);
  const plural = (n: number, w: string) =>
    `${n} ${w}${n === 1 ? "" : w.endsWith("h") ? "es" : "s"}`;
  if (count("output")) parts.push(plural(count("output"), "output"));
  if (count("decisions")) parts.push(plural(count("decisions"), "decision"));
  if (count("branches")) parts.push(plural(count("branches"), "branch"));
  if (count("requiredTools") || count("forbiddenTools")) parts.push("tools");
  if (typeof e.maxLatencyMs === "number") parts.push(`≤ ${e.maxLatencyMs} ms`);
  if (typeof e.maxCostUsd === "number") parts.push(`≤ $${e.maxCostUsd}`);
  return parts.join(", ") || "runs to completion";
}

/** pass / warn (warnings without a failing gate) / fail. */
export function gateOf(
  report: {
    verdict: "pass" | "fail";
    warnings: readonly unknown[];
  } | null,
): "pass" | "warn" | "fail" {
  if (!report) return "warn";
  if (report.verdict === "fail") return "fail";
  return report.warnings.length > 0 ? "warn" : "pass";
}

/** "ECE 0.031 (was 0.052)" for the worst-calibrated decision node. */
export function calibrationNote(
  s: EvaluationSummary,
  base?: EvaluationSummary | null,
): string | undefined {
  const entries = Object.entries(s.calibration);
  if (entries.length === 0) return undefined;
  const [node, worst] = entries.reduce((a, b) => (b[1].ece > a[1].ece ? b : a));
  const was = base?.calibration[node]?.ece;
  const pts = Math.round(worst.ece * 100);
  return `${node}: ECE ${worst.ece.toFixed(3)}${was !== undefined ? ` (was ${was.toFixed(3)})` : ""}; confidence tracks accuracy within ${pts} point${pts === 1 ? "" : "s"}.`;
}

// ── misc ────────────────────────────────────────────────────────────────────────────────────

/** Short, readable user-agent label ("Chrome on macOS"). */
export function describeUserAgent(ua: string | null): string {
  if (!ua) return "Unknown client";
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /Firefox\//.test(ua)
      ? "Firefox"
      : /Chrome\//.test(ua)
        ? "Chrome"
        : /Safari\//.test(ua)
          ? "Safari"
          : /curl\//.test(ua)
            ? "curl"
            : (ua.split(/[\s/]/)[0] ?? "Client");
  const os = /Mac OS X|Macintosh/.test(ua)
    ? "macOS"
    : /Windows/.test(ua)
      ? "Windows"
      : /Android/.test(ua)
        ? "Android"
        : /iPhone|iPad/.test(ua)
          ? "iOS"
          : /Linux/.test(ua)
            ? "Linux"
            : null;
  return os ? `${browser} on ${os}` : browser;
}

/** The API's password rule (apps/api auth/passwords.ts), checked before submitting. */
export function passwordProblem(password: string): string | null {
  if (password.length < 12) return "At least 12 characters";
  if (password.length > 256) return "At most 256 characters";
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((re) => re.test(password)).length;
  if (classes < 2) return "Mix at least two of lower case, upper case, digits and symbols";
  return null;
}

/** Days until an ISO date (negative when past). */
export function daysUntil(iso: string, now = Date.now()): number {
  return Math.floor((Date.parse(iso) - now) / 86_400_000);
}
