/**
 * The monthly budget at run start (`settings.budgets.monthlyCostUsd`): every run the API starts
 * (API, UI, draft, webhook, MCP, trigger fire, replay) and every evaluation is refused with 409
 * `BudgetExceededError` once this calendar month's spend (UTC) reaches the budget. Runs in flight
 * continue. Crossing 80 % and 100 % sends `budget.warning` / `budget.exceeded` to subscribed
 * notification channels, each at most once per month (the alert key names the month).
 */
import {
  monthlyBudgetOf,
  workspaceBudgetStatus,
  type BudgetStatus,
  type Tx,
} from "@flowaid/database";
import { budgetAlert } from "@flowaid/observability";
import { BudgetExceededError } from "@flowaid/workflow-core";
import type { ApiContext } from "../context.js";

/** Settings → Workspace, where the budget is set. */
function settingsUrl(ctx: ApiContext, workspaceSlug: string | null | undefined) {
  const base = ctx.config.webUrl.replace(/\/$/, "");
  return base && workspaceSlug ? `${base}/${workspaceSlug}/settings?tab=workspace` : undefined;
}

/** Sends the alert the spend calls for (never awaited: an alert must not hold up a run). */
export function notifyBudget(
  ctx: ApiContext,
  workspaceId: string,
  workspaceSlug: string | null | undefined,
  status: BudgetStatus,
): void {
  if (!ctx.alerts) return;
  const alert = budgetAlert(workspaceId, status, settingsUrl(ctx, workspaceSlug));
  if (alert) void ctx.alerts.dispatch(workspaceId, alert.key, alert.message).catch(() => undefined);
}

/**
 * Throws `BudgetExceededError` when the workspace has spent its monthly budget. `settings` are the
 * workspace's when the caller already read them; without a budget nothing is queried.
 */
export async function assertWithinBudget(
  ctx: ApiContext,
  tx: Tx,
  workspace: { id: string; slug?: string | null },
  settings?: unknown,
): Promise<void> {
  if (settings !== undefined && monthlyBudgetOf(settings) === null) return;
  const status = await workspaceBudgetStatus(tx, workspace.id, new Date(ctx.clock.now()), settings);
  if (status.monthlyCostUsd === null) return;
  notifyBudget(ctx, workspace.id, workspace.slug, status);
  if (status.reached)
    throw new BudgetExceededError(status.month, status.spentUsd, status.monthlyCostUsd);
}
