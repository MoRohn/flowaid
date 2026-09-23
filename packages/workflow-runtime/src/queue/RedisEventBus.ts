/**
 * `EventBus` over Redis pub/sub (ARCHITECTURE.md §5.12): one publishing and one subscribing
 * connection; messages are JSON. Publishers send ids only (`{ runId, fromSeq, toSeq }`) and
 * subscribers re-read durable events by seq; ephemeral deltas are forwarded as they are.
 */
import { Redis } from "ioredis";
import type { EventBus, JsonValue } from "@flowaid/workflow-core";

export class RedisEventBus implements EventBus {
  private readonly pub: Redis;
  private readonly sub: Redis;
  private readonly handlers = new Map<string, Set<(message: JsonValue) => void>>();

  constructor(
    url: string,
    private readonly prefix = "flowaid:",
  ) {
    this.pub = new Redis(url, { lazyConnect: false, maxRetriesPerRequest: null });
    this.sub = new Redis(url, { lazyConnect: false, maxRetriesPerRequest: null });
    this.sub.on("message", (channel: string, payload: string) => {
      const set = this.handlers.get(channel);
      if (!set) return;
      let message: JsonValue;
      try {
        message = JSON.parse(payload) as JsonValue;
      } catch {
        message = payload;
      }
      for (const fn of set) fn(message);
    });
  }

  async publish(channel: string, message: JsonValue): Promise<void> {
    await this.pub.publish(this.prefix + channel, JSON.stringify(message));
  }

  async subscribe(
    channel: string,
    onMessage: (message: JsonValue) => void,
  ): Promise<() => Promise<void>> {
    const key = this.prefix + channel;
    let set = this.handlers.get(key);
    if (!set) {
      set = new Set();
      this.handlers.set(key, set);
      await this.sub.subscribe(key);
    }
    set.add(onMessage);
    return async () => {
      const s = this.handlers.get(key);
      if (!s) return;
      s.delete(onMessage);
      if (s.size === 0) {
        this.handlers.delete(key);
        await this.sub.unsubscribe(key);
      }
    };
  }

  async close(): Promise<void> {
    await Promise.all([this.pub.quit(), this.sub.quit()]);
  }
}
