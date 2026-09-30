/**
 * What the Settings forms check before creating something (pure, so it is unit tested): an API
 * key's reach, and whether the notification channels cover the events someone has to act on.
 */
import type { Environment } from "~/api/types";
import type { NotificationChannel } from "../types";

export const ANY_ENVIRONMENT = "__any";
export const EXPIRY_DAYS = [30, 90, 180, 365] as const;

export interface ApiKeyDraft {
  name: string;
  mode: "live" | "test";
  scopes: string[];
  /** ANY_ENVIRONMENT or an environment id */
  env: string;
  /** workflow ids the key is limited to; empty: every workflow */
  pinned: string[];
  days: string;
  rate: number | null;
  serviceAccount: boolean;
}

export const emptyApiKeyDraft = (scopes: readonly string[]): ApiKeyDraft => ({
  name: "",
  mode: "live",
  scopes: [...scopes],
  env: ANY_ENVIRONMENT,
  pinned: [],
  days: "90",
  rate: null,
  serviceAccount: false,
});

/** The request body of `POST /v1/api-keys`. */
export function apiKeyBody(d: ApiKeyDraft, now = Date.now()): Record<string, unknown> {
  return {
    name: d.name.trim(),
    scopes: d.scopes,
    mode: d.mode,
    ...(d.env !== ANY_ENVIRONMENT ? { environmentId: d.env } : {}),
    ...(d.pinned.length ? { workflowIds: d.pinned } : {}),
    expiresAt: new Date(now + Number(d.days) * 86_400_000).toISOString(),
    ...(d.rate ? { rateLimitPerMin: d.rate } : {}),
    ...(d.serviceAccount ? { serviceAccount: { name: d.name.trim() } } : {}),
  };
}

export interface GuidanceCheck {
  id: string;
  state: "blocker" | "warning" | "info" | "ok";
  message: string;
  /** the step that changes it */
  step?: "name" | "scopes" | "reach" | "expiry";
}

/** Scopes that change or delete things, or reach secrets and access. */
const CHANGES = /:(write|publish|delete|cancel|approve|replay|bind|manage)$/;

export function apiKeyChecks(
  d: ApiKeyDraft,
  ctx: { environments: readonly Environment[]; isAdmin: boolean },
): GuidanceCheck[] {
  const out: GuidanceCheck[] = [];
  const env = ctx.environments.find((e) => e.id === d.env);
  if (!d.name.trim())
    out.push({ id: "name", state: "blocker", message: "Give the key a name", step: "name" });
  if (d.scopes.length === 0)
    out.push({
      id: "scopes",
      state: "blocker",
      message: "Choose at least one scope",
      step: "scopes",
    });
  if (!EXPIRY_DAYS.map(String).includes(d.days))
    out.push({ id: "expiry", state: "blocker", message: "Choose when it expires", step: "expiry" });
  if (d.mode === "test" && env?.protected)
    out.push({
      id: "test-protected",
      state: "blocker",
      message: `Test keys cannot be limited to ${env.name}, a protected environment: choose Live or another environment`,
      step: "reach",
    });
  if (d.serviceAccount && !ctx.isAdmin)
    out.push({
      id: "service-account",
      state: "blocker",
      message: "Only admins create service-account keys",
      step: "reach",
    });
  if (!out.some((c) => c.state === "blocker"))
    out.push({ id: "valid", state: "ok", message: "Everything the key needs is filled in" });

  if (d.scopes.includes("admin"))
    out.push({
      id: "admin",
      state: "warning",
      message:
        "admin gives the key full control of the workspace, including credentials and other keys.",
      step: "scopes",
    });
  const changing = d.scopes.filter((s) => s !== "admin" && CHANGES.test(s));
  if (changing.length)
    out.push({
      id: "changes",
      state: "info",
      message: `It can change things, not only read and run: ${changing.join(", ")}.`,
      step: "scopes",
    });
  if (d.scopes.includes("runs:create") && d.env === ANY_ENVIRONMENT)
    out.push({
      id: "env-any",
      state: "warning",
      message:
        "Not limited to an environment: every run request must name its environmentId, and the key can start runs in prod too.",
      step: "reach",
    });
  if (d.pinned.length === 0)
    out.push({
      id: "workflows-any",
      state: "info",
      message: "Reaches every workflow, including ones created later.",
      step: "reach",
    });
  if (Number(d.days) >= 365)
    out.push({
      id: "long",
      state: "info",
      message: "Lasts a year: note when to rotate it.",
      step: "expiry",
    });
  return out;
}

/** "In 23 days" style: whole days until an ISO date, negative when past. */
const daysLeft = (iso: string, now: number) => Math.floor((Date.parse(iso) - now) / 86_400_000);

/** Keys that stop working soon (or already have), for the API keys "What you need". */
export function expiringKeys<
  T extends { name: string; expiresAt: string; revokedAt: string | null },
>(keys: readonly T[], now = Date.now(), withinDays = 14): T[] {
  return keys.filter((k) => !k.revokedAt && daysLeft(k.expiresAt, now) < withinDays);
}

/**
 * Events that ask a person to act and that no enabled channel receives. Without
 * `human_task.created` a run can wait for an answer with nobody told.
 */
export function uncoveredEvents(
  channels: readonly Pick<NotificationChannel, "enabled" | "events">[],
  events: readonly string[] = ["human_task.created", "run.failed"],
): string[] {
  const covered = new Set<string>(channels.filter((c) => c.enabled).flatMap((c) => c.events));
  return events.filter((e) => !covered.has(e));
}
