import { describe, expect, it } from "vitest";
import { McpSessionPool } from "./pool.js";
import type { McpSession } from "./session.js";

const fakeSession = () => {
  const s = { isOpen: true, close: () => ((s.isOpen = false), Promise.resolve()) };
  return s as unknown as McpSession & { isOpen: boolean };
};
const server = {
  id: "s1",
  name: "S",
  transport: "streamable_http" as const,
  url: "https://x.test/mcp",
};

describe("McpSessionPool", () => {
  it("dedupes concurrent connects and keys by credential", async () => {
    let connects = 0;
    const pool = new McpSessionPool({
      connect: () => (connects++, Promise.resolve(fakeSession())),
    });
    const [a, b] = await Promise.all([pool.acquire(server, null), pool.acquire(server, null)]);
    expect(a).toBe(b);
    await pool.acquire(server, { id: "cred-2" });
    expect(connects).toBe(2);
    expect(pool.size).toBe(2);
  });

  it("backs off exponentially after failures and recovers", async () => {
    let t = 0;
    let fail = true;
    const pool = new McpSessionPool({
      clock: { now: () => t },
      backoffMs: 100,
      connect: () =>
        fail ? Promise.reject(new Error("ECONNREFUSED")) : Promise.resolve(fakeSession()),
    });
    await expect(pool.acquire(server, null)).rejects.toThrow("ECONNREFUSED");
    await expect(pool.acquire(server, null)).rejects.toMatchObject({
      code: "TOOL_EXECUTION_ERROR",
      retryable: true,
    });
    t = 100;
    await expect(pool.acquire(server, null)).rejects.toThrow("ECONNREFUSED");
    expect(pool.healthOf("s1")).toMatchObject({
      status: "degraded",
      consecutiveFailures: 2,
      retryAt: 300,
    });
    t = 300;
    await expect(pool.acquire(server, null)).rejects.toThrow();
    expect(pool.healthOf("s1").status).toBe("down");
    fail = false;
    t = 10_000;
    await pool.acquire(server, null);
    expect(pool.healthOf("s1")).toMatchObject({ status: "healthy", consecutiveFailures: 0 });
  });

  it("reconnects after a closed session and sweeps idle ones", async () => {
    let t = 0;
    const sessions: ReturnType<typeof fakeSession>[] = [];
    const pool = new McpSessionPool({
      clock: { now: () => t },
      idleMs: 1000,
      connect: () => Promise.resolve(sessions[sessions.push(fakeSession()) - 1] as McpSession),
    });
    const first = await pool.acquire(server, null);
    await first.close();
    expect(await pool.acquire(server, null)).not.toBe(first);
    t = 5000;
    expect(await pool.sweep()).toBe(1);
    expect(pool.size).toBe(0);
  });

  it("drops the session on a transport error inside withSession", async () => {
    const pool = new McpSessionPool({ connect: () => Promise.resolve(fakeSession()) });
    await expect(
      pool.withSession(server, null, () => Promise.reject(new Error("socket hang up"))),
    ).rejects.toThrow();
    expect(pool.size).toBe(0);
  });
});
