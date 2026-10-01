/**
 * `mcp.probe` (ARCHITECTURE.md §10.2): tests or discovers an MCP server for the API, which never
 * spawns stdio servers itself. The `jobs` row (kind `mcp.test` or `mcp.discover`) names a saved
 * server or carries an unsaved configuration; the worker connects with its own stdio policy (so
 * the allow-list, argument patterns and environment rules are checked again here), writes the
 * answer to `result`, and for a saved server's discovery stores the tools on the `mcp_servers`
 * row, as the API does for HTTP servers. Each spawn is audited `mcp_server.stdio_spawn` (names
 * only, never values). An unsaved configuration is removed from the row once the job ends.
 */
import { and, eq } from "drizzle-orm";
import type { CredentialService } from "@flowaid/credentials";
import { auditEvents, jobs, mcpServers, type Database } from "@flowaid/database";
import {
  discoverSession,
  failedTest,
  testSession,
  type McpServerConfig,
  type McpSession,
  type McpTransportKind,
  type StdioTransportOptions,
} from "@flowaid/mcp";
import { uuidv7 } from "@flowaid/shared";
import { NotFoundError, toFlowaidError, type Job, type JsonObject } from "@flowaid/workflow-core";

export type McpProbeJob = Extract<Job, { type: "mcp.probe" }>;

/** An unsaved server, as `POST /v1/mcp/servers/test` received it. */
export interface UnsavedMcpServer {
  name: string;
  transport: McpTransportKind;
  url?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  credentialId?: string | null;
}

export interface McpProbePayload {
  serverId?: string;
  config?: UnsavedMcpServer;
}

export type McpConnect = (
  server: McpServerConfig,
  credential: Record<string, string> | undefined,
  o: { signal: AbortSignal; onSpawn: NonNullable<StdioTransportOptions["onSpawn"]> },
) => Promise<McpSession>;

export interface McpProbeDeps {
  db: Database;
  credentials: Pick<CredentialService, "decrypt">;
  connect: McpConnect;
  /** per job (default 30 s) */
  timeoutMs?: number;
  now?: () => number;
}

/** Runs one probe; the `jobs` row records the outcome (the job never throws for a bad server). */
export async function runMcpProbeJob(deps: McpProbeDeps, job: McpProbeJob): Promise<void> {
  const now = deps.now ?? Date.now;
  const timeoutMs = deps.timeoutMs ?? 30_000;
  const [claimed] = await deps.db.system((tx) =>
    tx
      .update(jobs)
      .set({ status: "running", startedAt: new Date(now()) })
      .where(and(eq(jobs.id, job.jobId), eq(jobs.status, "queued")))
      .returning(),
  );
  if (!claimed) return; // already taken, finished, or the API stopped waiting and removed it
  const ws = claimed.workspaceId;
  const discover = claimed.kind === "mcp.discover";
  const payload = claimed.payload as McpProbePayload;
  const finish = (values: Partial<typeof jobs.$inferInsert>) =>
    deps.db.system((tx) =>
      tx
        .update(jobs)
        .set({ ...values, endedAt: new Date(now()), ...(payload.config ? { payload: {} } : {}) })
        .where(eq(jobs.id, job.jobId)),
    );

  let serverId: string | null = null;
  try {
    const row = payload.serverId
      ? (
          await deps.db.tenant(ws, (tx) =>
            tx
              .select()
              .from(mcpServers)
              .where(
                and(eq(mcpServers.id, payload.serverId ?? ""), eq(mcpServers.workspaceId, ws)),
              ),
          )
        )[0]
      : undefined;
    if (payload.serverId && !row) throw new NotFoundError("MCP server not found");
    serverId = row?.id ?? null;
    const source = row ?? payload.config;
    if (!source) throw new NotFoundError("the job names no MCP server");
    const config: McpServerConfig = {
      id: row?.id ?? `unsaved-${claimed.id}`,
      name: source.name,
      transport: source.transport,
      ...(source.url ? { url: source.url } : {}),
      ...(source.command
        ? { stdio: { command: source.command, args: source.args ?? [], env: source.env ?? {} } }
        : {}),
      ...(row ? { toolPolicy: row.toolPolicy } : {}),
      timeoutMs,
    };
    const credentialId = source.credentialId ?? null;
    const fields = credentialId ? await deps.credentials.decrypt(credentialId) : undefined;
    const spawned: JsonObject[] = [];
    const session = await deps.connect(config, fields, {
      signal: AbortSignal.timeout(timeoutMs),
      onSpawn: (info) =>
        spawned.push({ command: info.command, args: info.args, envNames: info.envNames }),
    });
    try {
      if (spawned.length)
        await deps.db.tenant(ws, (tx) =>
          tx.insert(auditEvents).values(
            spawned.map((details) => ({
              id: uuidv7(),
              workspaceId: ws,
              actorType: "system" as const,
              actorId: "worker",
              action: "mcp_server.stdio_spawn",
              resourceType: "mcp_server",
              resourceId: row?.id ?? "unsaved",
              details: { ...details, purpose: discover ? "discover" : "test" },
            })),
          ),
        );
      if (!discover) {
        await finish({
          status: "completed",
          result: { ...(await testSession(session, { timeoutMs })) },
        });
        return;
      }
      const d = await discoverSession(session, config, { timeoutMs });
      if (row)
        await deps.db.tenant(ws, (tx) =>
          tx
            .update(mcpServers)
            .set({
              status: "connected",
              discoveredTools: d.stored.discoveredTools,
              discoveredResources: d.stored.discoveredResources,
              discoveredPrompts: d.stored.discoveredPrompts,
              warnings: d.stored.warnings,
              lastError: null,
              lastCheckedAt: new Date(now()),
              updatedAt: new Date(now()),
            })
            .where(eq(mcpServers.id, row.id)),
        );
      await finish({ status: "completed", result: d.answer as unknown as JsonObject });
    } finally {
      await session.close();
    }
  } catch (error) {
    if (!discover) {
      // a server that does not answer is a test result, not a failed job
      await finish({ status: "completed", result: { ...failedTest(error) } });
      return;
    }
    const info = toFlowaidError(error).toInfo();
    if (serverId) {
      const id = serverId;
      await deps.db.tenant(ws, (tx) =>
        tx
          .update(mcpServers)
          .set({
            status: "error",
            lastError: info.message.slice(0, 500),
            lastCheckedAt: new Date(now()),
          })
          .where(eq(mcpServers.id, id)),
      );
    }
    await finish({ status: "failed", error: info });
  }
}
