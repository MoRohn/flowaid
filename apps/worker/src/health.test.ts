import { describe, expect, it } from "vitest";
import { heartbeatIsFresh } from "./health.js";

describe("worker health check", () => {
  const now = Date.parse("2026-09-27T12:00:00Z");
  it("is healthy while the heartbeat is recent", () => {
    expect(heartbeatIsFresh(JSON.stringify({ at: "2026-09-27T11:59:50Z", pid: 1 }), now)).toBe(
      true,
    );
  });
  it("is unhealthy when the heartbeat is stale, unreadable or missing its time", () => {
    expect(heartbeatIsFresh(JSON.stringify({ at: "2026-09-27T11:58:00Z" }), now)).toBe(false);
    expect(heartbeatIsFresh("not json", now)).toBe(false);
    expect(heartbeatIsFresh("{}", now)).toBe(false);
  });
});
