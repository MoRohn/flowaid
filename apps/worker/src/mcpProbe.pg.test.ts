import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { auditEvents, jobs, mcpServers } from "@flowaid/database";
import { describeDb } from "@flowaid/database/testing";
import { uuidv7 } from "@flowaid/shared";
import type { JsonObject } from "@flowaid/workflow-core";
import { createHarness, type Harness } from "./test/setup.js";

const NODE = process.execPath;
const FIXTURE = fileURLToPath(
  new URL("../../../packages/mcp/fixtures/tiny-stdio-server.mjs", import.meta.url),
);

describeDb("mcp.probe job: stdio servers tested and discovered by the worker (Postgres)", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness({
      extra: () => ({
        stdioPolicy: {
          enabled: true,
          allowedCommands: [
            { command: NODE, argsPattern: "\\S+[\\\\/]fixtures[\\\\/]tiny-stdio-server\\.mjs" },
          ],
          envAllowlist: ["TINY_GREETING"],
          parentEnv: {},
        },
      }),
    });
  });
  afterAll(() => h.close());

  async function probe(kind: "mcp.test" | "mcp.discover", payload: JsonObject) {
    const jobId = uuidv7();
    await h.db.app.system((tx) =>
      tx
        .insert(jobs)
        .values({ id: jobId, workspaceId: h.workspaceId, kind, payload, createdBy: "test" }),
    );
    await h.queue.enqueue("jobs", { type: "mcp.probe", jobId });
    for (let i = 0; i < 300; i++) {
      const [row] = await h.db.app.system((tx) => tx.select().from(jobs).where(eq(jobs.id, jobId)));
      if (row && (row.status === "completed" || row.status === "failed")) return row;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error("mcp.probe did not finish");
  }

  const addServer = async (command: string, args: string[]) => {
    const id = uuidv7();
    await h.db.app.system((tx) =>
      tx.insert(mcpServers).values({
        id,
        workspaceId: h.workspaceId,
        name: `local-${id.slice(-6)}`,
        transport: "stdio",
        command,
        args,
        env: { TINY_GREETING: "hello from env" },
      }),
    );
    return id;
  };

  it("discovers a saved stdio server and stores its tools on the server row", async () => {
    const id = await addServer(NODE, [FIXTURE]);
    const job = await probe("mcp.discover", { serverId: id });
    expect(job.status).toBe("completed");
    const answer = job.result as { tools: { name: string }[]; server: unknown };
    expect(answer.tools.map((t) => t.name).sort()).toEqual(["echo", "search_docs"]);
    expect(answer.server).toEqual({ name: "tiny-stdio", version: "1.0.0" });
    const [row] = await h.db.app.system((tx) =>
      tx.select().from(mcpServers).where(eq(mcpServers.id, id)),
    );
    expect(row).toMatchObject({ status: "connected", lastError: null });
    const search = row?.discoveredTools.find((t) => t.name === "search_docs") as
      (Record<string, unknown> & { description: string }) | undefined;
    // the server's own name is kept for tools/call; the allow-listed env reached the child
    expect(search).toMatchObject({
      "x-mcp-name": "search.docs",
      source: { kind: "mcp", serverId: id },
    });
    expect(search?.description).toContain("hello from env");
    // the spawn is audited with names only
    const audits = await h.db.app.system((tx) =>
      tx
        .select()
        .from(auditEvents)
        .where(
          and(eq(auditEvents.action, "mcp_server.stdio_spawn"), eq(auditEvents.resourceId, id)),
        ),
    );
    expect(audits).toHaveLength(1);
    expect(audits[0]?.details).toMatchObject({
      command: NODE,
      envNames: ["TINY_GREETING"],
      purpose: "discover",
    });
    expect(JSON.stringify(audits[0]?.details)).not.toContain("hello from env");
  });

  it("tests an unsaved configuration and drops it from the job afterwards", async () => {
    const job = await probe("mcp.test", {
      config: {
        name: "draft",
        transport: "stdio",
        command: NODE,
        args: [FIXTURE],
        env: { TINY_GREETING: "draft" },
        credentialId: null,
      },
    });
    expect(job).toMatchObject({
      status: "completed",
      result: { ok: true, server: { name: "tiny-stdio" }, toolCount: 2 },
      payload: {},
    });
  });

  it("applies its own stdio policy: a command off the allow-list is refused, not spawned", async () => {
    const id = await addServer("/usr/bin/env", ["node", FIXTURE]);
    const job = await probe("mcp.discover", { serverId: id });
    expect(job.status).toBe("failed");
    expect(job.error?.message).toContain("FLOWAID_MCP_STDIO_ALLOWED_COMMANDS");
    const [row] = await h.db.app.system((tx) =>
      tx.select().from(mcpServers).where(eq(mcpServers.id, id)),
    );
    expect(row?.status).toBe("error");
    expect(row?.lastError).toContain("FLOWAID_MCP_STDIO_ALLOWED_COMMANDS");
    expect(row?.discoveredTools).toEqual([]);
    const test = await probe("mcp.test", { serverId: id });
    expect(test).toMatchObject({ status: "completed", result: { ok: false } });
  });

  it("skips a job whose row the API already removed", async () => {
    const jobId = uuidv7();
    await h.queue.enqueue("jobs", { type: "mcp.probe", jobId });
    await new Promise((r) => setTimeout(r, 300));
    const rows = await h.db.app.system((tx) => tx.select().from(jobs).where(eq(jobs.id, jobId)));
    expect(rows).toEqual([]);
  });
});
