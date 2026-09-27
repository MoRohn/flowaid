/**
 * `McpSessionPool` (ARCHITECTURE.md §10.2): one live session per `(serverId, credentialId)`, reused
 * across node runs; reconnect with exponential backoff; a per-server health view; idle eviction.
 */
import { ToolExecutionError } from "@flowaid/workflow-core";
import type { CredentialFields } from "./auth.js";
import type { McpServerConfig } from "./connect.js";
import type { McpSession } from "./session.js";

export type SessionFactory = (
  server: McpServerConfig,
  credential: CredentialFields | undefined,
  signal?: AbortSignal,
) => Promise<McpSession>;

export interface PoolClock {
  now(): number;
}

export interface McpServerHealth {
  serverId: string;
  status: "healthy" | "degraded" | "down";
  consecutiveFailures: number;
  lastError: string | null;
  /** epoch ms before which a reconnect is not attempted */
  retryAt: number;
}

export interface PoolOptions {
  connect: SessionFactory;
  clock?: PoolClock;
  /** close sessions unused for this long (default 5 min) */
  idleMs?: number;
  /** first reconnect delay (default 500 ms), doubled per failure up to `maxBackoffMs` (default 60 s) */
  backoffMs?: number;
  maxBackoffMs?: number;
}

interface Entry {
  session?: McpSession;
  pending?: Promise<McpSession>;
  lastUsed: number;
}

/** The server is in backoff after failed connects; retryable. */
export class McpServerUnavailableError extends ToolExecutionError {
  constructor(message: string) {
    super(message, true, "mcp");
  }
}

export class McpSessionPool {
  private readonly entries = new Map<string, Entry>();
  private readonly health = new Map<string, McpServerHealth>();
  private readonly clock: PoolClock;

  constructor(private readonly opts: PoolOptions) {
    this.clock = opts.clock ?? { now: () => Date.now() };
  }

  static key(serverId: string, credentialId: string | null | undefined): string {
    return `${serverId}:${credentialId ?? "-"}`;
  }

  /** A live session for the server and credential, connecting (or reconnecting) when needed. */
  async acquire(
    server: McpServerConfig,
    credential: { id: string | null; fields?: CredentialFields } | null,
    signal?: AbortSignal,
  ): Promise<McpSession> {
    const key = McpSessionPool.key(server.id, credential?.id);
    const entry = this.entries.get(key) ?? { lastUsed: this.clock.now() };
    this.entries.set(key, entry);
    entry.lastUsed = this.clock.now();
    if (entry.session?.isOpen) return entry.session;
    if (entry.pending) return entry.pending;
    const h = this.healthOf(server.id);
    if (h.retryAt > this.clock.now())
      throw new McpServerUnavailableError(
        `MCP server ${server.name ?? server.id} is unavailable (${h.lastError ?? "recent failures"}); retrying after backoff`,
      );
    entry.pending = this.opts
      .connect(server, credential?.fields, signal)
      .then((session) => {
        entry.session = session;
        this.succeeded(server.id);
        return session;
      })
      .catch((error: unknown) => {
        this.failed(server.id, error);
        throw error;
      })
      .finally(() => {
        entry.pending = undefined;
      });
    return entry.pending;
  }

  /** Runs `fn` with a session; a transport failure drops the session so the next call reconnects. */
  async withSession<T>(
    server: McpServerConfig,
    credential: { id: string | null; fields?: CredentialFields } | null,
    fn: (session: McpSession) => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    const session = await this.acquire(server, credential, signal);
    try {
      return await fn(session);
    } catch (error) {
      if (!session.isOpen || isTransportError(error)) {
        await this.evict(server.id, credential?.id);
        this.failed(server.id, error);
      }
      throw error;
    }
  }

  healthOf(serverId: string): McpServerHealth {
    return (
      this.health.get(serverId) ?? {
        serverId,
        status: "healthy",
        consecutiveFailures: 0,
        lastError: null,
        retryAt: 0,
      }
    );
  }

  async evict(serverId: string, credentialId?: string | null): Promise<void> {
    const key = McpSessionPool.key(serverId, credentialId);
    const entry = this.entries.get(key);
    this.entries.delete(key);
    await entry?.session?.close().catch(() => undefined);
  }

  /** Closes sessions idle longer than `idleMs`; call it periodically. */
  async sweep(): Promise<number> {
    const cutoff = this.clock.now() - (this.opts.idleMs ?? 5 * 60_000);
    let closed = 0;
    for (const [key, entry] of [...this.entries]) {
      if (entry.lastUsed < cutoff && !entry.pending) {
        this.entries.delete(key);
        await entry.session?.close().catch(() => undefined);
        closed++;
      }
    }
    return closed;
  }

  async closeAll(): Promise<void> {
    const all = [...this.entries.values()];
    this.entries.clear();
    await Promise.all(
      all.map((e) => e.session?.close().catch(() => undefined) ?? Promise.resolve()),
    );
  }

  get size(): number {
    return this.entries.size;
  }

  private succeeded(serverId: string) {
    this.health.set(serverId, {
      serverId,
      status: "healthy",
      consecutiveFailures: 0,
      lastError: null,
      retryAt: 0,
    });
  }

  private failed(serverId: string, error: unknown) {
    const prev = this.healthOf(serverId);
    const failures = prev.consecutiveFailures + 1;
    const delay = Math.min(
      this.opts.maxBackoffMs ?? 60_000,
      (this.opts.backoffMs ?? 500) * 2 ** (failures - 1),
    );
    this.health.set(serverId, {
      serverId,
      status: failures >= 3 ? "down" : "degraded",
      consecutiveFailures: failures,
      lastError: error instanceof Error ? error.message.slice(0, 500) : String(error),
      retryAt: this.clock.now() + delay,
    });
  }
}

function isTransportError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : "";
  return /ECONNRESET|ECONNREFUSED|EPIPE|socket hang up|Connection closed|not connected|fetch failed/i.test(
    message,
  );
}
