/**
 * A stand-in for the worker's `mcp.probe` job in API tests: consumes the `jobs` queue, spawns the
 * stdio server through `@flowaid/mcp` under a stdio policy, and answers in the `jobs` row (and on
 * the server row for a saved server's discovery), as apps/worker/src/jobs/mcp.ts does.
 */
import { and, eq } from "drizzle-orm";
import { PgQueueDriver, jobs, mcpServers, type Database } from "@flowaid/database";
import {
  connectSession,
  discoverSession,
  failedTest,
  testSession,
  type McpServerConfig,
  type StdioPolicy,
} from "@flowaid/mcp";
import type { Job, JsonObject } from "@flowaid/workflow-core";

export class FakeMcpWorker {
  readonly seen: { kind: string; payload: JsonObject }[] = [];
  private stopper: { stop(): Promise<void> } | null = null;
  private readonly queue: PgQueueDriver;

  constructor(
    private readonly db: Database,
    private readonly policy: StdioPolicy,
  ) {
    this.queue = new PgQueueDriver(db.sql, { pollMs: 25, workerId: "fake-mcp-worker" });
  }

  async start(): Promise<void> {
    this.stopper = await this.queue.consume("jobs", (job) => this.handle(job), { concurrency: 2 });
  }

  async stop(): Promise<void> {
    await this.stopper?.stop();
    await this.queue.close();
  }

  private async handle(job: Job): Promise<void> {
    if (job.type !== "mcp.probe") return;
    const [row] = await this.db.system((tx) =>
      tx
        .update(jobs)
        .set({ status: "running" })
        .where(and(eq(jobs.id, job.jobId), eq(jobs.status, "queued")))
        .returning(),
    );
    if (!row) return;
    const payload = row.payload as {
      serverId?: string;
      config?: { name: string; command?: string; args?: string[]; env?: Record<string, string> };
    };
    this.seen.push({ kind: row.kind, payload: row.payload });
    const [server] = payload.serverId
      ? await this.db.system((tx) =>
          tx
            .select()
            .from(mcpServers)
            .where(eq(mcpServers.id, payload.serverId ?? "")),
        )
      : [];
    const source = server ?? payload.config;
    const config: McpServerConfig = {
      id: server?.id ?? "unsaved",
      name: source?.name ?? "unsaved",
      transport: "stdio",
      stdio: {
        command: source?.command ?? "",
        args: source?.args ?? [],
        env: source?.env ?? {},
      },
    };
    const done = (values: Partial<typeof jobs.$inferInsert>) =>
      this.db.system((tx) => tx.update(jobs).set(values).where(eq(jobs.id, job.jobId)));
    try {
      const session = await connectSession(config, undefined, {
        stdioPolicy: this.policy,
        timeoutMs: 10_000,
      });
      try {
        if (row.kind === "mcp.test") {
          await done({ status: "completed", result: { ...(await testSession(session)) } });
          return;
        }
        const d = await discoverSession(session, config);
        if (server)
          await this.db.system((tx) =>
            tx
              .update(mcpServers)
              .set({ status: "connected", ...d.stored })
              .where(eq(mcpServers.id, server.id)),
          );
        await done({ status: "completed", result: d.answer as unknown as JsonObject });
      } finally {
        await session.close();
      }
    } catch (error) {
      if (row.kind === "mcp.test")
        await done({ status: "completed", result: { ...failedTest(error) } });
      else
        await done({
          status: "failed",
          error: { code: "TOOL_EXECUTION_ERROR", message: String(error), retryable: false },
        });
    }
  }
}
