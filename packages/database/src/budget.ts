/**
 * The workspace's monthly budget (`workspaces.settings.budgets.monthlyCostUsd`): what it spent this
 * calendar month (UTC), the sum of `runs.cost_usd` over runs created in the month — one range scan
 * of `runs_ws_created_idx`. Runs are refused at start once the spend reaches the budget; runs in
 * flight are never stopped, so the month can end a little over it.
 */
import { and, eq, gte, lt, sql } from "drizzle-orm";
import type { Queryable } from "./db.js";
import { runs, workspaces } from "./schema.js";

/** The first instant of `at`'s calendar month in UTC, and of the next one. */
export function utcMonth(at: Date): { key: string; start: Date; end: Date } {
  const y = at.getUTCFullYear();
  const m = at.getUTCMonth();
  return {
    key: `${y}-${String(m + 1).padStart(2, "0")}`,
    start: new Date(Date.UTC(y, m, 1)),
    end: new Date(Date.UTC(y, m + 1, 1)),
  };
}

/** The monthly budget in USD from workspace settings; null when none is set (or it is not > 0). */
export function monthlyBudgetOf(settings: unknown): number | null {
  const budgets = (settings as { budgets?: { monthlyCostUsd?: unknown } } | null | undefined)
    ?.budgets;
  const v = budgets?.monthlyCostUsd;
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null;
}

/** USD the workspace's runs created in `at`'s UTC month have cost so far. */
export async function monthSpendUsd(tx: Queryable, workspaceId: string, at: Date): Promise<number> {
  const { start, end } = utcMonth(at);
  const [row] = await tx
    .select({ spent: sql<string>`coalesce(sum(${runs.costUsd}), 0)` })
    .from(runs)
    .where(
      and(eq(runs.workspaceId, workspaceId), gte(runs.createdAt, start), lt(runs.createdAt, end)),
    );
  return Number(row?.spent ?? 0);
}

export interface BudgetStatus {
  /** `YYYY-MM` (UTC) */
  month: string;
  monthlyCostUsd: number | null;
  spentUsd: number;
  /** spent ≥ budget: new runs are refused until the month ends or the budget is raised */
  reached: boolean;
}

/**
 * The month's spend against the budget. `settings` saves a read when the caller has them; without
 * a budget the spend is still summed (the settings page shows it).
 */
export async function workspaceBudgetStatus(
  tx: Queryable,
  workspaceId: string,
  at: Date,
  settings?: unknown,
): Promise<BudgetStatus> {
  let s = settings;
  if (s === undefined) {
    const [ws] = await tx
      .select({ settings: workspaces.settings })
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId));
    s = ws?.settings;
  }
  const monthlyCostUsd = monthlyBudgetOf(s);
  const spentUsd = await monthSpendUsd(tx, workspaceId, at);
  return {
    month: utcMonth(at).key,
    monthlyCostUsd,
    spentUsd,
    reached: monthlyCostUsd !== null && spentUsd >= monthlyCostUsd,
  };
}

/** `workspaceBudgetStatus` when the workspace has a budget; null (one settings read) when not. */
export async function budgetStatusIfSet(
  tx: Queryable,
  workspaceId: string,
  at: Date,
): Promise<BudgetStatus | null> {
  const [ws] = await tx
    .select({ settings: workspaces.settings })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId));
  if (monthlyBudgetOf(ws?.settings) === null) return null;
  return workspaceBudgetStatus(tx, workspaceId, at, ws?.settings);
}
