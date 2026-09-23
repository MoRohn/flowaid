/**
 * `EventBus` over Postgres LISTEN/NOTIFY: the fan-out used when Redis is not configured.
 * Messages are JSON, at most 7 900 bytes (Postgres caps NOTIFY payloads at 8 000); publishers send
 * ids only (`{ runId, fromSeq, toSeq }`) and subscribers re-read durable events by seq.
 * postgres.js keeps one dedicated listening connection and re-subscribes after reconnecting.
 */
import type { Sql } from "postgres";
import { PayloadTooLargeError, type EventBus, type JsonValue } from "@flowaid/workflow-core";

export const MAX_NOTIFY_BYTES = 7_900;

export class PgEventBus implements EventBus {
  constructor(private readonly sql: Sql) {}

  async publish(channel: string, message: JsonValue): Promise<void> {
    const payload = JSON.stringify(message);
    if (Buffer.byteLength(payload, "utf8") > MAX_NOTIFY_BYTES)
      throw new PayloadTooLargeError(
        `An event bus message is limited to ${MAX_NOTIFY_BYTES} bytes; publish ids and re-read the data`,
      );
    await this.sql`select pg_notify(${channel}, ${payload})`;
  }

  async subscribe(
    channel: string,
    onMessage: (message: JsonValue) => void,
  ): Promise<() => Promise<void>> {
    const listener = await this.sql.listen(channel, (payload) => {
      let message: JsonValue;
      try {
        message = JSON.parse(payload) as JsonValue;
      } catch {
        message = payload;
      }
      onMessage(message);
    });
    return () => listener.unlisten();
  }
}
