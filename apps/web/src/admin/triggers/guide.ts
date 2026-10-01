/**
 * What the Add webhook / Add schedule steps check before a trigger is written into a draft, and
 * the example input they offer. Every note comes from real state (the workflow, its deployments,
 * the workspace's live webhooks); pure, so it is unit tested.
 */
import type { NewTrigger } from "./add";

export interface TriggerNote {
  id: string;
  state: "blocker" | "warning" | "info";
  message: string;
}

export interface TriggerContext {
  workflowId: string;
  /** published versions exist (the workflow's latest version number, null when never published) */
  latestVersion: number | null;
  /** where a version runs now */
  deployments: readonly { environment: string; version: number | null }[];
  environments: readonly { id: string; name: string; protected: boolean }[];
  /** every live webhook of the workspace (path is `<environment>/<path>`) */
  liveWebhooks: readonly { workflowId: string; path: string }[];
  /** the draft's input schema */
  inputs: unknown;
}

/** An IANA time zone the browser (and croner on the server) understands. */
export function validTimezone(tz: string): boolean {
  if (!tz.trim()) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz.trim() });
    return true;
  } catch {
    return false;
  }
}

/** Runs a day for the cadences people pick most; others are not estimated. */
const RUNS_PER_DAY: Readonly<Record<string, number>> = {
  "*/5 * * * *": 288,
  "*/10 * * * *": 144,
  "*/15 * * * *": 96,
  "*/30 * * * *": 48,
  "0 * * * *": 24,
};

export interface InputField {
  name: string;
  type: string;
  required: boolean;
  description?: string;
}

/** The top-level fields of a workflow's input schema. */
export function inputFields(schema: unknown): InputField[] {
  const s = schema as {
    properties?: Record<string, { type?: unknown; description?: unknown }>;
    required?: unknown;
  } | null;
  const required = new Set(Array.isArray(s?.required) ? (s.required as string[]) : []);
  return Object.entries(s?.properties ?? {}).map(([name, p]) => ({
    name,
    type: Array.isArray(p.type) ? p.type.join(" | ") : typeof p.type === "string" ? p.type : "any",
    required: required.has(name),
    ...(typeof p.description === "string" && p.description ? { description: p.description } : {}),
  }));
}

/** A placeholder input shaped like the schema, meant to be edited (never real data). */
export function exampleInput(schema: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const props =
    (
      schema as {
        properties?: Record<string, { type?: unknown; enum?: unknown; default?: unknown }>;
      }
    )?.properties ?? {};
  for (const [name, p] of Object.entries(props)) {
    const type: unknown = Array.isArray(p.type) ? (p.type as unknown[])[0] : p.type;
    out[name] =
      p.default !== undefined
        ? p.default
        : Array.isArray(p.enum) && p.enum.length
          ? p.enum[0]
          : type === "number" || type === "integer"
            ? 0
            : type === "boolean"
              ? false
              : type === "array"
                ? []
                : type === "object"
                  ? {}
                  : `example ${name.replace(/[_-]+/g, " ")}`;
  }
  return out;
}

/** Required input fields the value leaves out. */
export function missingInputs(schema: unknown, value: unknown): string[] {
  const obj = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return inputFields(schema)
    .filter((f) => f.required && (obj as Record<string, unknown>)[f.name] === undefined)
    .map((f) => f.name);
}

const list = (xs: readonly string[]) =>
  xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1) ?? ""}`;

/**
 * What to know before adding the trigger: conflicts that make a later deployment fail, signing
 * and response trade-offs, schedule problems, and where the workflow is live today.
 */
export function triggerNotes(trigger: NewTrigger, ctx: TriggerContext): TriggerNote[] {
  const notes: TriggerNote[] = [];
  if (trigger.type === "webhook") {
    const clash = ctx.environments
      .filter((e) =>
        ctx.liveWebhooks.some(
          (h) => h.path === `${e.name}/${trigger.path}` && h.workflowId !== ctx.workflowId,
        ),
      )
      .map((e) => e.name);
    if (clash.length)
      notes.push({
        id: "path-taken",
        state: "warning",
        message: `Another workflow already uses /${trigger.path} in ${list(clash)}: deploying this one there will be refused. Choose another path.`,
      });
    if (trigger.signature === "none") {
      const guarded = ctx.environments.filter((e) => e.protected).map((e) => e.name);
      notes.push({
        id: "unsigned",
        state: "warning",
        message: `Unsigned: anyone who learns the URL can start runs.${guarded.length ? ` ${list(guarded)} ${guarded.length === 1 ? "is" : "are"} protected and refuse unsigned calls.` : ""}`,
      });
    } else
      notes.push({
        id: "secret",
        state: "info",
        message:
          "After each deployment, generate the signing secret for that environment on the Webhooks tab. Until then every call is refused.",
      });
    if (trigger.responseMode === "sync")
      notes.push({
        id: "sync",
        state: "info",
        message:
          "Callers wait up to 30 seconds for the output. Slower runs, and runs that wait for a person, answer 202 with the run id instead.",
      });
    const fields = inputFields(ctx.inputs).filter((f) => f.required);
    if (fields.length)
      notes.push({
        id: "body",
        state: "info",
        message: `Callers must send a JSON body with ${list(fields.map((f) => f.name))}; other calls are rejected and listed under Deliveries.`,
      });
  } else {
    if (!validTimezone(trigger.timezone))
      notes.push({
        id: "timezone",
        state: "blocker",
        message: `${trigger.timezone || "An empty value"} is not a time zone. Use a name such as Europe/Paris or UTC.`,
      });
    const perDay = RUNS_PER_DAY[trigger.cron.trim().replace(/\s+/g, " ")];
    if (perDay)
      notes.push({
        id: "cadence",
        state: "info",
        message: `Starts ${perDay} runs a day in each environment it is deployed to. Each is a real run of the workflow.`,
      });
    const missing = missingInputs(ctx.inputs, trigger.input);
    if (missing.length)
      notes.push({
        id: "input",
        state: "warning",
        message: `The workflow's input requires ${list(missing)}, which this input leaves out. Deploying a version with this schedule is refused until the input has them (Run now refuses it too).`,
      });
  }
  const live = ctx.deployments.map((d) => `${d.environment}${d.version ? ` (v${d.version})` : ""}`);
  notes.push(
    live.length
      ? {
          id: "lifecycle",
          state: "info",
          message: `Live now in ${list(live)}. That version keeps running without this trigger until you publish a new version and deploy it.`,
        }
      : ctx.latestVersion === null
        ? {
            id: "lifecycle",
            state: "info",
            message:
              "This workflow has never been published. The trigger goes live once you publish a version and deploy it to an environment.",
          }
        : {
            id: "lifecycle",
            state: "info",
            message: `Version ${ctx.latestVersion} is published but not deployed anywhere. Publish again with this trigger and deploy it to an environment.`,
          },
  );
  return notes;
}

/** Triggers of one kind already in a draft, as short labels ("/orders", "0 9 * * 1-5 UTC"). */
export function existingTriggers(
  definition: { triggers?: readonly Record<string, unknown>[] } | undefined,
  type: "webhook" | "schedule",
): string[] {
  return (definition?.triggers ?? [])
    .filter((t) => t.type === type)
    .map((t) =>
      type === "webhook"
        ? `/${String(t.path)}`
        : `${String(t.cron)} ${typeof t.timezone === "string" ? t.timezone : "UTC"}`,
    );
}

export interface PageCheck {
  id: string;
  state: "ok" | "blocker" | "warning" | "info" | "optional" | "checking";
  label: string;
  detail?: string;
  /** a page that fixes it */
  fix?: { href: string; label: string };
}

/**
 * "What you need" on each Triggers tab, from what the page already loaded: workflows (and whether
 * any is published), the live rows of that tab, and what the person's role allows.
 */
export function triggerPageChecks(
  tab: "webhooks" | "schedules" | "mcp",
  i: {
    ws: string;
    /** undefined while loading */
    workflows?: readonly { latestVersion: number | null }[];
    webhooks?: readonly { enabled: boolean; signature: string; secretBound: boolean }[];
    schedules?: readonly { enabled: boolean; lastError: string | null }[];
    exposures?: readonly { enabled: boolean }[];
    can: (scope: string) => boolean;
  },
): PageCheck[] {
  const out: PageCheck[] = [];
  const w = i.workflows;
  if (!w) out.push({ id: "workflows", state: "checking", label: "Workflows" });
  else if (w.length === 0)
    out.push({
      id: "workflows",
      state: "blocker",
      label: "A workflow to start",
      detail: "Triggers start workflows; there is none yet.",
      fix: { href: `/${i.ws}/workflows`, label: "Create a workflow" },
    });
  else {
    const published = w.filter((x) => x.latestVersion !== null).length;
    out.push(
      published
        ? {
            id: "workflows",
            state: "ok",
            label: `${published} of ${w.length} workflow${w.length === 1 ? "" : "s"} published`,
          }
        : {
            id: "workflows",
            state: "warning",
            label: "No workflow is published yet",
            detail:
              tab === "mcp"
                ? "Clients can only call a workflow with a version deployed to the tool's environment."
                : "You can add triggers to a draft now; they go live after you publish and deploy.",
          },
    );
  }
  if (tab === "webhooks") {
    if (!i.can("webhooks:write"))
      out.push({ id: "role", state: "info", label: "Your role cannot see or manage webhooks" });
    else if (i.webhooks) {
      const locked = i.webhooks.filter(
        (h) => h.enabled && h.signature !== "none" && !h.secretBound,
      ).length;
      const unsigned = i.webhooks.filter((h) => h.enabled && h.signature === "none").length;
      if (locked)
        out.push({
          id: "secrets",
          state: "warning",
          label: `${locked} webhook${locked === 1 ? " refuses" : "s refuse"} every call until you generate a signing secret`,
          detail: "Press Generate secret on the row, then give it to the sender.",
        });
      if (unsigned)
        out.push({
          id: "unsigned",
          state: "warning",
          label: `${unsigned} unsigned webhook${unsigned === 1 ? "" : "s"}: anyone with the URL can start runs`,
        });
      const on = i.webhooks.filter((h) => h.enabled).length;
      if (on && !locked && !unsigned)
        out.push({
          id: "live",
          state: "ok",
          label: `${on} webhook${on === 1 ? "" : "s"} live and signed`,
        });
    }
  } else if (tab === "schedules") {
    if (!i.can("schedules:write"))
      out.push({ id: "role", state: "info", label: "Your role cannot see or manage schedules" });
    else if (i.schedules?.length) {
      const failing = i.schedules.filter((x) => x.lastError).length;
      out.push(
        failing
          ? {
              id: "live",
              state: "warning",
              label: `${failing} schedule${failing === 1 ? "" : "s"} could not start the last run`,
              detail: "The red line under each one says why.",
            }
          : {
              id: "live",
              state: "ok",
              label: `${i.schedules.filter((x) => x.enabled).length} of ${i.schedules.length} schedules running`,
            },
      );
    }
  } else {
    if (i.exposures?.length) {
      const off = i.exposures.filter((e) => !e.enabled).length;
      out.push(
        off
          ? {
              id: "live",
              state: "warning",
              label: `${off} exposed tool${off === 1 ? " is" : "s are"} disabled`,
              detail: "A later deployment switched it off; stop exposing it and expose it again.",
            }
          : { id: "live", state: "ok", label: `${i.exposures.length} workflows exposed as tools` },
      );
    }
    if (!i.can("api_keys:manage"))
      out.push({
        id: "tokens",
        state: "info",
        label: "Your role cannot mint MCP tokens",
        detail: "Someone who manages API keys can mint one for your client.",
      });
  }
  if (tab !== "mcp" && !i.can("workflows:write"))
    out.push({ id: "add", state: "info", label: "Your role cannot add triggers to workflows" });
  if (tab === "mcp" && !i.can("mcp:write"))
    out.push({ id: "add", state: "info", label: "Your role cannot expose workflows" });
  return out;
}
