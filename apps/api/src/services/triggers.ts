/**
 * Trigger materialisation (ARCHITECTURE.md §8): deploying a version to an environment upserts one
 * row per trigger — `webhooks` (path `<environment>/<path>`), `schedules` (next run from croner),
 * `mcp_exposures` — disables rows whose trigger disappeared (never deletes them), and refuses paths,
 * tool names or event names another workflow of the workspace already uses (`E_TRIGGER_CONFLICT`).
 * A schedule's stored input must match the deployed version's inputs schema (`E_SCHEMA` at
 * `/triggers/<i>/input`): the scheduler checks it again at every fire.
 */
import { Cron } from "croner";
import { and, eq, ne } from "drizzle-orm";
import { environments, mcpExposures, schedules, webhooks, type Tx } from "@flowaid/database";
import { uuidv7 } from "@flowaid/shared";
import { describeInputIssues, inputIssues } from "@flowaid/workflow-compiler";
import { WorkflowValidationError, type JsonSchema, type Trigger } from "@flowaid/workflow-core";

export interface MaterialisedTriggers {
  webhooks: { id: string; path: string; url: string; signature: string; secretBound: boolean }[];
  schedules: { id: string; cron: string; timezone: string; nextRunAt: string | null }[];
  mcpExposures: { id: string; toolName: string }[];
  disabled: { kind: "webhook" | "schedule" | "mcp"; id: string }[];
}

export function nextRun(cron: string, timezone: string, from: Date): Date | null {
  try {
    return new Cron(cron, { timezone, paused: true }).nextRun(from) ?? null;
  } catch {
    return null;
  }
}

/** A 422 carrying one diagnostic, like a compile failure. */
export function diagnosticError(
  code: "E_TRIGGER_CONFLICT" | "E_SCHEMA",
  message: string,
  path: string,
): WorkflowValidationError {
  return new WorkflowValidationError([{ code, severity: "error", message, location: { path } }]);
}

function conflict(message: string, path: string): never {
  throw diagnosticError("E_TRIGGER_CONFLICT", message, path);
}

export async function materialiseTriggers(
  tx: Tx,
  i: {
    workspaceId: string;
    workspaceSlug: string;
    workflowId: string;
    environmentId: string;
    triggers: readonly Trigger[];
    /** the deployed version's inputs schema: schedule inputs are checked against it */
    inputs: JsonSchema;
    baseUrl: string;
    now: Date;
  },
): Promise<MaterialisedTriggers> {
  const [env] = await tx.select().from(environments).where(eq(environments.id, i.environmentId));
  if (!env) throw diagnosticError("E_SCHEMA", "unknown environment", "/environmentId");
  const out: MaterialisedTriggers = { webhooks: [], schedules: [], mcpExposures: [], disabled: [] };

  // Webhooks
  const wantHooks = i.triggers.flatMap((t, idx) => (t.type === "webhook" ? [{ t, idx }] : []));
  const ownHooks = await tx
    .select()
    .from(webhooks)
    .where(and(eq(webhooks.workflowId, i.workflowId), eq(webhooks.environmentId, i.environmentId)));
  const keepHooks = new Set<string>();
  for (const { t, idx } of wantHooks) {
    const path = `${env.name}/${t.path}`;
    const [taken] = await tx
      .select()
      .from(webhooks)
      .where(
        and(
          eq(webhooks.workspaceId, i.workspaceId),
          eq(webhooks.path, path),
          ne(webhooks.workflowId, i.workflowId),
        ),
      );
    if (taken)
      conflict(
        `webhook path '${t.path}' is used by another workflow in ${env.name}`,
        `/triggers/${idx}/path`,
      );
    const existing = ownHooks.find((h) => h.path === path);
    const values = {
      signature: t.signature,
      responseMode: t.responseMode,
      inputPointer: t.inputPointer,
      allowedHeaders: t.allowedHeaders,
      enabled: true,
    };
    let id: string;
    let secretBound: boolean;
    if (existing) {
      await tx.update(webhooks).set(values).where(eq(webhooks.id, existing.id));
      id = existing.id;
      secretBound = existing.secretCredentialId !== null;
    } else {
      id = uuidv7();
      await tx.insert(webhooks).values({
        id,
        workspaceId: i.workspaceId,
        workflowId: i.workflowId,
        environmentId: i.environmentId,
        path,
        ...values,
      });
      secretBound = false;
    }
    keepHooks.add(id);
    out.webhooks.push({
      id,
      path,
      url: `${i.baseUrl.replace(/\/$/, "")}/hooks/${i.workspaceSlug}/${path}`,
      signature: t.signature,
      secretBound: secretBound || t.signature === "none",
    });
  }
  for (const h of ownHooks)
    if (!keepHooks.has(h.id) && h.enabled) {
      await tx.update(webhooks).set({ enabled: false }).where(eq(webhooks.id, h.id));
      out.disabled.push({ kind: "webhook", id: h.id });
    }

  // Schedules (keyed by cron + timezone)
  const ownSchedules = await tx
    .select()
    .from(schedules)
    .where(
      and(eq(schedules.workflowId, i.workflowId), eq(schedules.environmentId, i.environmentId)),
    );
  const keepSchedules = new Set<string>();
  for (const [idx, t] of i.triggers.entries()) {
    if (t.type !== "schedule") continue;
    const issues = inputIssues(i.inputs, t.input);
    if (issues.length > 0)
      throw diagnosticError(
        "E_SCHEMA",
        `schedule trigger ${idx + 1} (${t.cron}): its input does not match the workflow's inputs: ${describeInputIssues(issues)}`,
        `/triggers/${idx}/input`,
      );
    const next = nextRun(t.cron, t.timezone, i.now);
    if (!next)
      throw diagnosticError(
        "E_SCHEMA",
        `invalid cron expression '${t.cron}'`,
        `/triggers/${idx}/cron`,
      );
    const existing = ownSchedules.find(
      (s) =>
        s.cron === t.cron &&
        s.timezone === t.timezone &&
        JSON.stringify(s.input) === JSON.stringify(t.input),
    );
    let id: string;
    if (existing) {
      await tx
        .update(schedules)
        .set({ enabled: true, nextRunAt: next })
        .where(eq(schedules.id, existing.id));
      id = existing.id;
    } else {
      id = uuidv7();
      await tx.insert(schedules).values({
        id,
        workspaceId: i.workspaceId,
        workflowId: i.workflowId,
        environmentId: i.environmentId,
        cron: t.cron,
        timezone: t.timezone,
        input: t.input as never,
        nextRunAt: next,
      });
    }
    keepSchedules.add(id);
    out.schedules.push({ id, cron: t.cron, timezone: t.timezone, nextRunAt: next.toISOString() });
  }
  for (const s of ownSchedules)
    if (!keepSchedules.has(s.id) && s.enabled) {
      await tx.update(schedules).set({ enabled: false }).where(eq(schedules.id, s.id));
      out.disabled.push({ kind: "schedule", id: s.id });
    }

  // MCP exposures (tool names are unique per workspace)
  const ownExposures = await tx
    .select()
    .from(mcpExposures)
    .where(
      and(
        eq(mcpExposures.workflowId, i.workflowId),
        eq(mcpExposures.environmentId, i.environmentId),
      ),
    );
  const keepExposures = new Set<string>();
  for (const [idx, t] of i.triggers.entries()) {
    if (t.type !== "mcp") continue;
    const [taken] = await tx
      .select()
      .from(mcpExposures)
      .where(
        and(
          eq(mcpExposures.workspaceId, i.workspaceId),
          eq(mcpExposures.toolName, t.toolName),
          ne(mcpExposures.workflowId, i.workflowId),
        ),
      );
    if (taken)
      conflict(
        `MCP tool name '${t.toolName}' is used by another workflow`,
        `/triggers/${idx}/toolName`,
      );
    const [sameName] = await tx
      .select()
      .from(mcpExposures)
      .where(
        and(eq(mcpExposures.workspaceId, i.workspaceId), eq(mcpExposures.toolName, t.toolName)),
      );
    let id: string;
    if (sameName) {
      // One exposure per tool name: it follows the latest environment deployed with it.
      await tx
        .update(mcpExposures)
        .set({ description: t.description, enabled: true, environmentId: i.environmentId })
        .where(eq(mcpExposures.id, sameName.id));
      id = sameName.id;
    } else {
      id = uuidv7();
      await tx.insert(mcpExposures).values({
        id,
        workspaceId: i.workspaceId,
        workflowId: i.workflowId,
        environmentId: i.environmentId,
        toolName: t.toolName,
        description: t.description,
      });
    }
    keepExposures.add(id);
    out.mcpExposures.push({ id, toolName: t.toolName });
  }
  for (const e of ownExposures)
    if (!keepExposures.has(e.id) && e.enabled) {
      await tx.update(mcpExposures).set({ enabled: false }).where(eq(mcpExposures.id, e.id));
      out.disabled.push({ kind: "mcp", id: e.id });
    }
  return out;
}
