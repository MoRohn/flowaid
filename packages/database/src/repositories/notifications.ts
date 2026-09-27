/** Workspace notification channels (API.md §3.10): the enabled channels subscribed to an event. */
import { and, eq, sql } from "drizzle-orm";
import type { Tx } from "../db.js";
import { notifications } from "../schema.js";

export type NotificationRow = typeof notifications.$inferSelect;

/** Enabled channels of the workspace whose `events` include `event`. */
export async function notificationTargets(
  tx: Tx,
  workspaceId: string,
  event: string,
): Promise<NotificationRow[]> {
  return tx
    .select()
    .from(notifications)
    .where(
      and(
        eq(notifications.workspaceId, workspaceId),
        eq(notifications.enabled, true),
        sql`${notifications.events} @> ${JSON.stringify([event])}::jsonb`,
      ),
    );
}
