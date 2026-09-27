/**
 * Storage for observability alerts (`@flowaid/observability` `AlertStore`): the workspace's
 * enabled notification channels subscribed to an event, and `alert_deliveries`, whose unique
 * `(channel_id, key)` makes each occurrence send at most once across retries and workers.
 */
import { and, eq, sql } from "drizzle-orm";
import { uuidv7 } from "@flowaid/shared";
import type { JsonObject } from "@flowaid/workflow-core";
import type { Database } from "./db.js";
import { alertDeliveries, notifications } from "./schema.js";

export interface AlertChannelRow {
  id: string;
  kind: "email" | "slack_webhook" | "webhook";
  name: string;
  config: JsonObject;
  credentialId: string | null;
}

export async function alertChannels(
  db: Database,
  workspaceId: string,
  event: string,
): Promise<AlertChannelRow[]> {
  return db.system((tx) =>
    tx
      .select({
        id: notifications.id,
        kind: notifications.kind,
        name: notifications.name,
        config: notifications.config,
        credentialId: notifications.credentialId,
      })
      .from(notifications)
      .where(
        and(
          eq(notifications.workspaceId, workspaceId),
          eq(notifications.enabled, true),
          sql`${notifications.events} @> ${JSON.stringify([event])}::jsonb`,
        ),
      ),
  );
}

export async function claimAlertDelivery(
  db: Database,
  input: { workspaceId: string; channelId: string; event: string; key: string },
): Promise<string | null> {
  const rows = await db.system((tx) =>
    tx
      .insert(alertDeliveries)
      .values({ id: uuidv7(), ...input })
      .onConflictDoNothing()
      .returning({ id: alertDeliveries.id }),
  );
  return rows[0]?.id ?? null;
}

export async function finishAlertDelivery(
  db: Database,
  id: string,
  result: { status: "sent" | "failed"; error?: string },
): Promise<void> {
  await db.system((tx) =>
    tx
      .update(alertDeliveries)
      .set({
        status: result.status,
        error: result.error ?? null,
        ...(result.status === "sent" ? { sentAt: new Date() } : {}),
      })
      .where(eq(alertDeliveries.id, id)),
  );
}
