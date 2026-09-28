/**
 * Adding a trigger to a workflow's draft (TriggerSchema in workflow-core): the Triggers page and
 * the workflow's trigger settings write it into the draft; publishing and deploying make it live.
 * Pure, so it is unit tested.
 */

export type NewTrigger =
  | {
      type: "webhook";
      path: string;
      signature: "hmac_sha256" | "token" | "none";
      responseMode: "async" | "sync";
    }
  | { type: "schedule"; cron: string; timezone: string; input: unknown };

export const WEBHOOK_PATH = /^[a-z0-9-]{3,64}$/;

/** `Refund desk` → `refund-desk`: a webhook path (3–64 of a-z, 0-9 and -). */
export function webhookPathFrom(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
    .replace(/-+$/, "");
  return slug.length >= 3 ? slug : `${slug || "hook"}-in`;
}

/** Presets people pick from; anything else is typed as a custom cron. */
export const CRON_PRESETS: readonly { cron: string; label: string }[] = [
  { cron: "*/15 * * * *", label: "Every 15 minutes" },
  { cron: "0 * * * *", label: "Every hour" },
  { cron: "0 9 * * *", label: "Every day at 09:00" },
  { cron: "0 9 * * 1-5", label: "Weekdays at 09:00" },
  { cron: "0 9 * * 1", label: "Mondays at 09:00" },
];

/** Five space-separated cron fields (the API checks the values; this catches the shape). */
export function cronProblem(cron: string): string | null {
  const parts = cron.trim().split(/\s+/);
  return parts.length === 5 && cron.trim().length >= 9
    ? null
    : "Use five fields: minute, hour, day of month, month, day of week";
}

type Definition = Record<string, unknown> & { triggers?: readonly Record<string, unknown>[] };

/**
 * The draft with the trigger appended, or why it cannot be: a webhook path is unique within a
 * workflow, and one schedule runs a workflow once per tick.
 */
export function withTrigger(
  definition: Definition,
  trigger: NewTrigger,
): { definition: Definition } | { error: string } {
  const triggers = [...(definition.triggers ?? [])];
  if (trigger.type === "webhook") {
    if (!WEBHOOK_PATH.test(trigger.path))
      return { error: "Use 3 to 64 lowercase letters, digits and dashes" };
    if (triggers.some((t) => t.type === "webhook" && t.path === trigger.path))
      return { error: `This workflow already has a webhook at /${trigger.path}` };
    triggers.push({ ...trigger, inputPointer: "/body", allowedHeaders: [] });
  } else {
    const problem = cronProblem(trigger.cron);
    if (problem) return { error: problem };
    const cron = trigger.cron.trim().replace(/\s+/g, " ");
    if (triggers.some((t) => t.type === "schedule" && t.cron === cron))
      return { error: "This workflow already runs on that schedule" };
    triggers.push({ ...trigger, cron });
  }
  return { definition: { ...definition, triggers } };
}

const NL = " \\\n";

/** A shell request that calls a webhook, with the headers its signature scheme needs. */
export function exampleWebhookRequest(
  url: string,
  signature: "hmac_sha256" | "token" | "none",
): string {
  const body = `'{"message":"Hello"}'`;
  const json = "  -H 'content-type: application/json'";
  if (signature === "token")
    return [
      `curl -X POST ${url}`,
      json,
      "  -H 'x-webhook-token: <signing secret>'",
      `  -d ${body}`,
    ].join(NL);
  if (signature === "none") return [`curl -X POST ${url}`, json, `  -d ${body}`].join(NL);
  // the MAC covers `<timestamp>.<raw body>` (ingress.ts)
  return [
    `BODY=${body}`,
    "TS=$(date +%s)",
    `SIG=$(printf '%s.%s' "$TS" "$BODY" | openssl dgst -sha256 -hmac '<signing secret>' -r | cut -d' ' -f1)`,
    [
      `curl -X POST ${url}`,
      json,
      `  -H "x-timestamp: $TS" -H "x-signature: sha256=$SIG"`,
      `  -d "$BODY"`,
    ].join(NL),
  ].join("\n");
}
