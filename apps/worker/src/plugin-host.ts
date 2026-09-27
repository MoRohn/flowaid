/**
 * The plugin host process (forked by `plugins/host.ts`): loads one plugin package and runs its
 * nodes. The node's `ctx` is a proxy — every service call becomes a JSON message the worker
 * answers with the node's real, scoped services; logs, events and deltas are one-way notes.
 * Nothing here holds a credential, a database connection or the worker's environment.
 */
import { pathToFileURL } from "node:url";
import { normalizePackage, type AnyNodeDefinition, type ExecutionContext } from "@flowaid/node-sdk";
import type { JsonObject, JsonValue, ModelRef } from "@flowaid/workflow-core";
import { errorInfo, fromErrorInfo } from "./plugins/host.js";
import { BUNDLED_LOADERS } from "./plugins/loaders.js";
import {
  providerKey,
  type ContextSnapshot,
  type FromHost,
  type ToHost,
  type WireResponse,
} from "./plugins/protocol.js";

const nodes = new Map<string, AnyNodeDefinition>();
const executions = new Map<string, AbortController>();
const calls = new Map<
  string,
  {
    resolve(v: JsonValue): void;
    reject(e: unknown): void;
    chunk?(v: JsonValue): void;
    end?(): void;
  }
>();
let seq = 0;

function send(m: FromHost): void {
  process.send?.(m);
}

function call(id: string, method: string, args: JsonValue[]): Promise<JsonValue> {
  const callId = `${id}:${++seq}`;
  return new Promise((resolve, reject) => {
    calls.set(callId, { resolve, reject });
    send({ type: "call", id, callId, method, args });
  });
}

/** A streamed call: chunks arrive until `end`. */
async function* streamCall(
  id: string,
  method: string,
  args: JsonValue[],
): AsyncGenerator<JsonValue> {
  const callId = `${id}:${++seq}`;
  const queue: JsonValue[] = [];
  const s: { finished: boolean; failure: Error | null; wake: (() => void) | null } = {
    finished: false,
    failure: null,
    wake: null,
  };
  calls.set(callId, {
    resolve: () => undefined,
    reject: (e) => ((s.failure = e instanceof Error ? e : new Error(String(e))), s.wake?.()),
    chunk: (v) => (queue.push(v), s.wake?.()),
    end: () => ((s.finished = true), s.wake?.()),
  });
  send({ type: "call", id, callId, method, args });
  try {
    for (;;) {
      if (queue.length) yield queue.shift() as JsonValue;
      else if (s.failure) throw s.failure;
      else if (s.finished) return;
      else await new Promise<void>((r) => (s.wake = r));
    }
  } finally {
    calls.delete(callId);
  }
}

/** Strips the non-JSON parts of a provider call context (the worker re-adds its signal). */
const plainCallCtx = (c: unknown): JsonValue => {
  const { signal: _signal, ...rest } = (c ?? {}) as Record<string, unknown>;
  return rest as JsonObject;
};

function contextFor(id: string, snap: ContextSnapshot, signal: AbortSignal): ExecutionContext {
  const log = (level: "debug" | "info" | "warn" | "error") => (message: string, data?: JsonValue) =>
    send({ type: "note", id, kind: "log", payload: { level, message, data: data ?? null } });
  const facts = (kind: "generation" | "embedding", ref: ModelRef, slot?: string) =>
    snap.providers[providerKey(kind, ref, slot)] ?? snap.providers[providerKey(kind, ref)];
  const ctx = {
    run: snap.run,
    node: snap.node,
    config: snap.config,
    vars: snap.vars,
    scope: snap.scope,
    signal,
    logger: { debug: log("debug"), info: log("info"), warn: log("warn"), error: log("error") },
    credentials: {
      get: (slot: string) => call(id, "credentials.get", [slot]),
      has: (slot: string) => snap.credentialSlots.includes(slot),
    },
    providers: {
      decision: (chain: JsonValue, opts?: JsonObject) =>
        new Proxy(
          { id: "remote", model: "remote", capabilities: {} },
          {
            get: (target, prop) =>
              prop in target
                ? target[prop as keyof typeof target]
                : prop === "health"
                  ? () => ({
                      status: "healthy",
                      errorRate1m: 0,
                      p95LatencyMs: 0,
                      consecutiveFailures: 0,
                    })
                  : (...args: unknown[]) =>
                      call(id, "providers.decision", [
                        chain,
                        opts ?? null,
                        String(prop),
                        ...(args.slice(0, -1) as JsonValue[]),
                        plainCallCtx(args.at(-1)),
                      ]),
          },
        ),
      generation: (ref: ModelRef, opts?: { credentialSlot?: string }) => {
        const f = facts("generation", ref, opts?.credentialSlot);
        return {
          id: (f?.id as string | undefined) ?? ref.provider,
          model: (f?.model as string | undefined) ?? ref.model,
          capabilities: (f?.capabilities as JsonObject | undefined) ?? {
            tools: true,
            jsonSchema: true,
            vision: false,
            streaming: true,
            thinking: false,
            maxContext: 128_000,
          },
          generate: (req: JsonValue, c: unknown) =>
            call(id, "providers.generation.generate", [ref, opts ?? null, req, plainCallCtx(c)]),
          stream: (req: JsonValue, c: unknown) =>
            streamCall(id, "providers.generation.stream", [
              ref,
              opts ?? null,
              req,
              plainCallCtx(c),
            ]),
          health: () => ({
            status: "healthy",
            errorRate1m: 0,
            p95LatencyMs: 0,
            consecutiveFailures: 0,
          }),
        };
      },
      embedding: (ref: ModelRef, opts?: { credentialSlot?: string }) => {
        const f = facts("embedding", ref, opts?.credentialSlot);
        return {
          id: (f?.id as string | undefined) ?? ref.provider,
          model: (f?.model as string | undefined) ?? ref.model,
          dimensions: (f?.dimensions as number | undefined) ?? 0,
          embed: (texts: string[], c: unknown) =>
            call(id, "providers.embedding.embed", [ref, opts ?? null, texts, plainCallCtx(c)]),
          health: () => ({
            status: "healthy",
            errorRate1m: 0,
            p95LatencyMs: 0,
            consecutiveFailures: 0,
          }),
        };
      },
    },
    tools: {
      list: () => call(id, "tools.list", []),
      call: (source: JsonValue, name: string, args: JsonValue, opts?: JsonObject) =>
        call(id, "tools.call", [source, name, args, opts ?? null]),
    },
    state: {
      get: (ns: string, key: string) => call(id, "state.get", [ns, key]),
      set: (ns: string, key: string, value: JsonValue, opts?: JsonObject) =>
        call(id, "state.set", [ns, key, value, opts ?? null]).then(() => undefined),
      cas: (ns: string, key: string, version: number, value: JsonValue) =>
        call(id, "state.cas", [ns, key, version, value]),
    },
    artifacts: {
      put: (name: string, data: Uint8Array | string, mime: string, opts?: JsonObject) =>
        call(id, "artifacts.put", [
          name,
          {
            base64: Buffer.from(
              typeof data === "string" ? new TextEncoder().encode(data) : data,
            ).toString("base64"),
          },
          mime,
          opts ?? null,
        ]),
      get: async (artifactId: string) => {
        const r = (await call(id, "artifacts.get", [artifactId])) as { base64: string };
        return new Uint8Array(Buffer.from(r.base64, "base64"));
      },
      url: (artifactId: string, ttlMs: number) => call(id, "artifacts.url", [artifactId, ttlMs]),
    },
    events: {
      emit: (event: JsonValue) => send({ type: "note", id, kind: "event", payload: event }),
      stream: (channel: string, delta: string) =>
        send({ type: "note", id, kind: "stream", payload: { channel, delta } }),
    },
    budget: snap.budget,
    http: async (url: string, init?: RequestInit) => {
      const body =
        init?.body === undefined || init.body === null
          ? null
          : Buffer.from(
              typeof init.body === "string"
                ? new TextEncoder().encode(init.body)
                : new Uint8Array(await new Response(init.body).arrayBuffer()),
            ).toString("base64");
      const wire = (await call(id, "http", [
        url,
        {
          method: init?.method ?? "GET",
          headers: Object.fromEntries(new Headers(init?.headers).entries()),
          body,
        },
      ])) as unknown as WireResponse;
      const res = new Response(
        wire.status === 204 || wire.status === 304 ? null : Buffer.from(wire.body, "base64"),
        { status: wire.status, statusText: wire.statusText, headers: wire.headers },
      );
      Object.defineProperty(res, "url", { value: wire.url });
      return res;
    },
    clock: { now: () => new Date() },
    ...(snap.resume ? { resume: snap.resume } : {}),
    ...(snap.sandbox
      ? {
          sandbox: {
            run: (req: JsonValue) => call(id, "sandbox.run", [req]),
            shell: (req: JsonValue) => call(id, "sandbox.shell", [req]),
          },
        }
      : {}),
  };
  return ctx as unknown as ExecutionContext;
}

async function init(m: Extract<ToHost, { type: "init" }>): Promise<void> {
  let module: Record<string, unknown>;
  let version: string;
  if (m.modulePath) {
    module = (await import(pathToFileURL(m.modulePath).href)) as Record<string, unknown>;
    version = m.version ?? "0.0.0";
  } else {
    const loader = BUNDLED_LOADERS[m.packageName];
    if (!loader) throw new Error(`${m.packageName} is not a package this worker can host`);
    ({ module, version } = await loader());
  }
  const normalized = normalizePackage(module, { name: m.packageName, version });
  if (!normalized.ok) throw new Error(normalized.diagnostics.map((d) => d.message).join("; "));
  for (const def of normalized.package.nodes) nodes.set(`${def.id}@${def.version}`, def);
  send({ type: "ready", nodes: [...nodes.keys()] });
}

async function execute(m: Extract<ToHost, { type: "execute" }>): Promise<void> {
  const def = nodes.get(`${m.nodeType}@${m.version}`);
  const controller = new AbortController();
  executions.set(m.id, controller);
  let result: JsonValue;
  try {
    if (!def) throw new Error(`${m.nodeType}@${m.version} is not in this plugin host`);
    const r = await def.execute(contextFor(m.id, m.ctx, controller.signal), m.input);
    result =
      r.kind === "error"
        ? { kind: "error", error: errorInfo(r.error) as unknown as JsonObject }
        : (r as unknown as JsonValue);
  } catch (error) {
    result = { kind: "error", error: errorInfo(error) as unknown as JsonObject };
  } finally {
    executions.delete(m.id);
  }
  send({ type: "done", id: m.id, result });
}

process.on("message", (m: ToHost) => {
  switch (m.type) {
    case "init":
      init(m).catch((e: unknown) =>
        send({ type: "init_failed", message: e instanceof Error ? e.message : String(e) }),
      );
      return;
    case "execute":
      void execute(m);
      return;
    case "abort":
      executions.get(m.id)?.abort(new Error("cancelled by the worker"));
      return;
    case "reply": {
      const c = calls.get(m.callId);
      calls.delete(m.callId);
      if (m.ok) c?.resolve(m.value);
      else c?.reject(fromErrorInfo(m.error));
      return;
    }
    case "chunk":
      calls.get(m.callId)?.chunk?.(m.value);
      return;
    case "end":
      calls.get(m.callId)?.end?.();
      return;
  }
});
process.on("disconnect", () => process.exit(0));
