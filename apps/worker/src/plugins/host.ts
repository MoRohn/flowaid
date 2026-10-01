/**
 * Plugin host processes (ARCHITECTURE.md §3.5, D21): plugin node code runs in a child process per
 * package, never in the orchestrator. `PluginHost` forks `plugin-host` with a scrubbed
 * environment, a heap cap, no code generation from strings and the Node permission model, in
 * production and in development alike:
 *
 * - `--permission` with `--allow-fs-read` limited to the host's code (the compiled app and its
 *   `node_modules`, or the development bundle), the packages provided to plugins and the plugin's
 *   own directory. No `--allow-fs-write`, `--allow-child-process`, `--allow-worker`,
 *   `--allow-addons`, `--allow-wasi` or `--allow-inspector`: the runtime refuses them all.
 * - Network: on Node versions whose permission model knows `--allow-net` (25+), it is withheld,
 *   so the runtime refuses sockets and DNS. Node 24's permission model does not cover the
 *   network; there the in-process guard (`guard.ts`) refuses network built-ins and globals.
 *   Either way a plugin's way out is `ctx.http`, proxied to the worker's guarded fetch.
 *
 * A TypeScript loader cannot run under the permission model (it needs worker threads and reads
 * outside any narrow allow-list), so a development checkout bundles `plugin-host.ts` with esbuild
 * first and runs the bundle exactly like the compiled entry.
 *
 * The node's `ctx` is proxied over the IPC channel as JSON: the host asks for every service call
 * (credentials, providers, tools, state, artifacts, http, sandbox) and the worker performs it with
 * the real, node-scoped services.
 *
 * A crashed host fails its in-flight executions with a retryable NODE_EXECUTION_ERROR
 * (`details.reason: "PLUGIN_HOST_CRASHED"`) and is restarted for the next execution. This is a
 * process boundary with the permission model, for admin-installed code; user code belongs in the
 * `code` pool's sandbox. What the isolation does and does not cover is listed in
 * docs/security/THREAT_MODEL.md.
 */
import { fork, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, realpathSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type * as Esbuild from "esbuild";
import type {
  AnyNodeDefinition,
  ExecutionContext,
  NodePackage,
  NodeResult,
} from "@flowaid/node-sdk";
import { uuidv7 } from "@flowaid/shared";
import {
  FlowaidError,
  NodeExecutionError,
  toFlowaidError,
  type ErrorCode,
  type ErrorInfo,
  type JsonObject,
  type JsonValue,
  type ModelRef,
} from "@flowaid/workflow-core";
import type { WorkerLogger } from "../worker.js";
import {
  providerKey,
  type ContextSnapshot,
  type FromHost,
  type ToHost,
  type WireResponse,
} from "./protocol.js";

/** An error that crossed the process boundary, with its original code. */
export class RemoteNodeError extends FlowaidError {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly retryable: boolean,
    details?: JsonValue,
  ) {
    super(message, details);
  }
}

export function errorInfo(error: unknown): ErrorInfo {
  const e = toFlowaidError(error);
  return {
    code: e.code,
    message: e.message,
    retryable: e.retryable,
    ...(e.details !== undefined ? { details: e.details } : {}),
  };
}

export function fromErrorInfo(info: ErrorInfo): FlowaidError {
  return new RemoteNodeError(info.code, info.message, info.retryable, info.details);
}

const toBase64 = (data: Uint8Array | string) =>
  Buffer.from(typeof data === "string" ? new TextEncoder().encode(data) : data).toString("base64");

/** Packages the platform provides to plugins (`installed.ts` links them; the guard maps them). */
export const PROVIDED_PACKAGES = ["@flowaid/node-sdk", "@flowaid/workflow-core", "zod"] as const;

/** Whether this Node's permission model covers the network (`--allow-net`, Node 25+). */
export const PERMISSION_COVERS_NETWORK = process.allowedNodeEnvironmentFlags.has("--allow-net");

const here = dirname(fileURLToPath(import.meta.url));
/** This module runs compiled (`dist/plugins/host.js`) rather than from TypeScript sources. */
const COMPILED = fileURLToPath(import.meta.url).endsWith(".js");

/** The directory `pnpm-workspace.yaml` sits in, if any (a monorepo checkout). */
function workspaceRoot(from: string): string | null {
  let dir = from;
  for (;;) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    const up = dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

/** The root directory of a package this module resolves (where its package.json is). */
function packageDirOf(name: string): string | null {
  try {
    let dir = dirname(fileURLToPath(import.meta.resolve(name)));
    while (!existsSync(join(dir, "package.json"))) {
      const up = dirname(dir);
      if (up === dir) return null;
      dir = up;
    }
    return dir;
  } catch {
    return null;
  }
}

let devBundle: Promise<string> | null = null;

/**
 * Development: bundles `plugin-host.ts` (workspace sources under the `development` condition,
 * third-party packages inlined) into one ES module under `node_modules/.cache`, named by its
 * content hash so concurrent workers and test files share it.
 */
function bundleForDevelopment(source: string, appDir: string): Promise<string> {
  devBundle ??= (async () => {
    // a development-only tool (a root devDependency): never reached from the compiled worker
    const tool = "esbuild";
    const esbuild = (await import(tool)) as typeof Esbuild;
    const result = await esbuild.build({
      entryPoints: [source],
      bundle: true,
      platform: "node",
      format: "esm",
      target: `node${process.versions.node.split(".")[0] ?? "24"}`,
      conditions: ["development"],
      write: false,
      logLevel: "silent",
      legalComments: "none",
      // CommonJS dependencies inlined into an ES module still call require for built-ins
      banner: {
        js: 'import { createRequire as __flowaidCreateRequire } from "node:module"; const require = __flowaidCreateRequire(import.meta.url);',
      },
    });
    const code = result.outputFiles[0]?.contents;
    if (!code) throw new Error("esbuild produced no plugin host bundle");
    const hash = createHash("sha256").update(code).digest("hex").slice(0, 16);
    const dir = join(appDir, "node_modules", ".cache", "flowaid-plugin-host");
    const file = join(dir, `plugin-host-${hash}.mjs`);
    if (!existsSync(file)) {
      await mkdir(dir, { recursive: true });
      const tmp = `${file}.${process.pid}.tmp`;
      await writeFile(tmp, code);
      await rename(tmp, file);
    }
    return file;
  })().catch((error: unknown) => {
    devBundle = null;
    throw error;
  });
  return devBundle;
}

/**
 * The host entry and the paths it may read: `dist/plugin-host.js` with the app (and, in a
 * monorepo, the workspace packages and `node_modules`, never the repository root with its `.env`
 * and `.flowaid/`); in development, the bundle alone.
 */
async function hostEntry(): Promise<{ file: string; readable: string[] }> {
  const appDir = resolve(here, "../..");
  if (COMPILED) {
    const root = workspaceRoot(appDir);
    return {
      file: resolve(here, "../plugin-host.js"),
      readable: [
        appDir,
        ...(root && root !== appDir ? [join(root, "packages"), join(root, "node_modules")] : []),
      ],
    };
  }
  const file = await bundleForDevelopment(resolve(here, "../plugin-host.ts"), appDir);
  return { file, readable: [file] };
}

/** The flags the host process starts with (exported for the isolation tests). */
export function hostExecArgv(readable: string[], maxOldSpaceMb: number): string[] {
  return [
    "--permission",
    ...readable.map((d) => `--allow-fs-read=${d}`),
    "--disallow-code-generation-from-strings",
    `--max-old-space-size=${maxOldSpaceMb}`,
  ];
}

/** `{ provider, model }` objects anywhere in a config (the model refs a node will ask for). */
function modelRefs(value: JsonValue, out: ModelRef[] = []): ModelRef[] {
  if (Array.isArray(value)) for (const v of value) modelRefs(v, out);
  else if (value && typeof value === "object") {
    const o = value;
    if (typeof o.provider === "string" && typeof o.model === "string")
      out.push({ provider: o.provider, model: o.model });
    for (const v of Object.values(o)) modelRefs(v, out);
  }
  return out;
}

interface Pending {
  ctx: ExecutionContext;
  resolve(result: NodeResult<JsonObject>): void;
  reject(error: unknown): void;
}

export interface PluginHostOptions {
  packageName: string;
  version?: string;
  /** an installed package's entry file; bundled packages load from the allow-list */
  modulePath?: string;
  /** the installed package's root (readable by the host; defaults to the entry's directory) */
  packageDir?: string;
  log: WorkerLogger;
  /** heap cap of the host process (MiB) */
  maxOldSpaceMb?: number;
  /** the host's whole environment (scrubbed: NODE_ENV and LOG_LEVEL by default) */
  env?: Record<string, string>;
}

export class PluginHost {
  private child: ChildProcess | null = null;
  private starting: Promise<ChildProcess> | null = null;
  private readonly pending = new Map<string, Pending>();
  /** restarts so far (diagnostics, tests) */
  restarts = 0;

  constructor(private readonly o: PluginHostOptions) {}

  /** Forks the host and waits until it has loaded its package. */
  start(): Promise<ChildProcess> {
    if (this.child?.connected) return Promise.resolve(this.child);
    this.starting ??= this.spawn().finally(() => (this.starting = null));
    return this.starting;
  }

  private async spawn(): Promise<ChildProcess> {
    const entry = await hostEntry();
    const pluginRoot =
      this.o.packageDir ?? (this.o.modulePath ? dirname(this.o.modulePath) : undefined);
    const real = (d: string) => (existsSync(d) ? realpathSync(d) : d);
    const readable = [
      ...entry.readable,
      // `zod/v4` and other subpaths of the provided packages, through the plugin's links
      ...(pluginRoot ? PROVIDED_PACKAGES.map(packageDirOf) : []),
      pluginRoot ?? null,
    ]
      .filter((d): d is string => d !== null)
      // the permission model compares real paths (symlinked dirs, /var -> /private/var)
      .map(real);
    const child = fork(entry.file, [], {
      execArgv: hostExecArgv([...new Set(readable)], this.o.maxOldSpaceMb ?? 512),
      env: this.o.env ?? { NODE_ENV: "production", LOG_LEVEL: "info" },
      serialization: "json",
      stdio: ["ignore", "inherit", "inherit", "ipc"],
    });
    return new Promise((resolveReady, rejectReady) => {
      const onBoot = (m: FromHost) => {
        if (m.type === "ready") {
          child.off("message", onBoot);
          this.child = child;
          child.on("message", (msg: FromHost) => this.onMessage(msg));
          this.o.log.info({ plugin: this.o.packageName, pid: child.pid }, "plugin host ready");
          resolveReady(child);
        } else if (m.type === "init_failed") {
          child.kill();
          rejectReady(new Error(`plugin host for ${this.o.packageName}: ${m.message}`));
        }
      };
      child.on("message", onBoot);
      child.once("exit", (code, signal) => {
        const was = this.child === child;
        if (was) this.child = null;
        rejectReady(new Error(`plugin host exited during start (${code ?? signal})`));
        if (was) this.crashed(code, signal);
      });
      this.send(child, {
        type: "init",
        packageName: this.o.packageName,
        ...(this.o.version ? { version: this.o.version } : {}),
        // real paths: the guard compares importers against the real plugin root
        ...(this.o.modulePath ? { modulePath: real(this.o.modulePath) } : {}),
        ...(pluginRoot ? { pluginRoot: real(pluginRoot) } : {}),
      });
    });
  }

  private send(child: ChildProcess, message: ToHost): void {
    if (child.connected) child.send(message);
  }

  private crashed(code: number | null, signal: NodeJS.Signals | null): void {
    this.restarts++;
    this.o.log.error(
      { plugin: this.o.packageName, code, signal, inFlight: this.pending.size },
      "plugin host crashed; restarting on the next execution",
    );
    const error = new NodeExecutionError(
      `the plugin host of ${this.o.packageName} crashed (${code ?? signal ?? "unknown"})`,
      true,
      { reason: "PLUGIN_HOST_CRASHED" },
    );
    for (const p of this.pending.values()) p.reject(error);
    this.pending.clear();
  }

  /** Runs one plugin node in the host with its context proxied back here. */
  async execute(
    def: AnyNodeDefinition,
    ctx: ExecutionContext,
    input: JsonObject,
  ): Promise<NodeResult<JsonObject>> {
    const child = await this.start();
    const id = uuidv7();
    const snapshot = snapshotOf(def, ctx);
    return new Promise((resolveResult, rejectResult) => {
      const onAbort = () => this.send(child, { type: "abort", id });
      ctx.signal.addEventListener("abort", onAbort, { once: true });
      const settle = () => {
        ctx.signal.removeEventListener("abort", onAbort);
        this.pending.delete(id);
      };
      this.pending.set(id, {
        ctx,
        resolve: (r) => (settle(), resolveResult(r)),
        reject: (e) => (settle(), rejectResult(e instanceof Error ? e : new Error(String(e)))),
      });
      this.send(child, {
        type: "execute",
        id,
        nodeType: def.id,
        version: def.version,
        input,
        ctx: snapshot,
      });
    });
  }

  private onMessage(m: FromHost): void {
    if (m.type === "ready" || m.type === "init_failed") return;
    const p = this.pending.get(m.id);
    if (!p) return;
    switch (m.type) {
      case "done": {
        const r = m.result as JsonObject;
        if (r.kind === "error")
          p.resolve({ kind: "error", error: fromErrorInfo(r.error as unknown as ErrorInfo) });
        else p.resolve(r as unknown as NodeResult<JsonObject>);
        return;
      }
      case "note":
        note(p.ctx, m.kind, m.payload);
        return;
      case "call":
        void this.answer(p, m.callId, m.method, m.args);
        return;
    }
  }

  private async answer(p: Pending, callId: string, method: string, args: JsonValue[]) {
    const child = this.child;
    if (!child) return;
    try {
      if (method === "providers.generation.stream") {
        const [ref, opts, req, callCtx] = args as [ModelRef, JsonObject, JsonObject, JsonObject];
        const provider = p.ctx.providers.generation(ref, opts);
        for await (const chunk of provider.stream(req as never, withSignal(callCtx, p.ctx)))
          this.send(child, { type: "chunk", callId, value: chunk as unknown as JsonValue });
        this.send(child, { type: "end", callId });
        return;
      }
      const value = await perform(p.ctx, method, args);
      this.send(child, { type: "reply", callId, ok: true, value });
    } catch (error) {
      this.send(child, { type: "reply", callId, ok: false, error: errorInfo(error) });
    }
  }

  stop(): Promise<void> {
    const child = this.child;
    this.child = null;
    if (!child) return Promise.resolve();
    return new Promise((done) => {
      child.once("exit", () => done());
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 5_000).unref();
    });
  }
}

function withSignal(callCtx: JsonObject | undefined, ctx: ExecutionContext) {
  return { ...(callCtx ?? {}), signal: ctx.signal } as never;
}

function note(ctx: ExecutionContext, kind: "log" | "event" | "stream", payload: JsonValue) {
  const o = payload as JsonObject;
  if (kind === "log") {
    const level = o.level as "debug" | "info" | "warn" | "error";
    ctx.logger[level](
      typeof o.message === "string" ? o.message : JSON.stringify(o.message),
      o.data,
    );
  } else if (kind === "event") ctx.events.emit(o as never);
  else
    ctx.events.stream(
      o.channel as "text" | "thinking" | "tool_args",
      typeof o.delta === "string" ? o.delta : "",
    );
}

/** One proxied service call, performed with the node's real context. */
async function perform(
  ctx: ExecutionContext,
  method: string,
  args: JsonValue[],
): Promise<JsonValue> {
  const a = args as unknown as [never, never, never, never];
  switch (method) {
    case "credentials.get":
      return await ctx.credentials.get(a[0]);
    case "providers.decision": {
      const [chain, opts, name, ...rest] = args as unknown as [
        never,
        never,
        string,
        ...JsonValue[],
      ];
      const provider = ctx.providers.decision(chain, opts) as unknown as Record<
        string,
        (...x: unknown[]) => Promise<unknown>
      >;
      const callCtx = rest.pop() as JsonObject;
      return (await provider[name]?.(...rest, withSignal(callCtx, ctx))) as JsonValue;
    }
    case "providers.generation.generate": {
      const [ref, opts, req, callCtx] = a;
      return (await ctx.providers
        .generation(ref, opts)
        .generate(req, withSignal(callCtx, ctx))) as unknown as JsonValue;
    }
    case "providers.embedding.embed": {
      const [ref, opts, texts, callCtx] = a;
      return await ctx.providers.embedding(ref, opts).embed(texts, withSignal(callCtx, ctx));
    }
    case "tools.list":
      return (await ctx.tools.list()) as unknown as JsonValue;
    case "tools.call":
      return (await ctx.tools.call(a[0], a[1], a[2], a[3])) as unknown as JsonValue;
    case "state.get":
      return await ctx.state.get(a[0], a[1]);
    case "state.set":
      await ctx.state.set(a[0], a[1], a[2], a[3]);
      return null;
    case "state.cas":
      return await ctx.state.cas(a[0], a[1], a[2], a[3]);
    case "artifacts.put": {
      const [name, data, mime, opts] = args as [string, { base64: string }, string, JsonObject];
      return await ctx.artifacts.put(name, Buffer.from(data.base64, "base64"), mime, opts);
    }
    case "artifacts.get":
      return { base64: toBase64(await ctx.artifacts.get(a[0])) };
    case "artifacts.url":
      return await ctx.artifacts.url(a[0], a[1]);
    case "http": {
      const [url, init] = args as [string, JsonObject];
      const body = typeof init.body === "string" ? Buffer.from(init.body, "base64") : undefined;
      const res = await ctx.http(url, {
        ...(init as RequestInit),
        ...(body ? { body } : { body: undefined }),
        signal: ctx.signal,
      });
      const wire: WireResponse = {
        status: res.status,
        statusText: res.statusText,
        headers: [...res.headers.entries()],
        body: toBase64(new Uint8Array(await res.arrayBuffer())),
        url: res.url,
      };
      return wire as unknown as JsonValue;
    }
    case "sandbox.run":
      if (!ctx.sandbox) throw new Error("no sandbox for this node");
      return (await ctx.sandbox.run(a[0])) as unknown as JsonValue;
    case "sandbox.shell":
      if (!ctx.sandbox) throw new Error("no sandbox for this node");
      return (await ctx.sandbox.shell(a[0])) as unknown as JsonValue;
    default:
      throw new Error(`plugin host asked for an unknown service: ${method}`);
  }
}

/** The synchronous part of a node's context, as JSON. */
export function snapshotOf(def: AnyNodeDefinition, ctx: ExecutionContext): ContextSnapshot {
  const slots = (def.credentials ?? []).map((c) => c.name);
  const providers: Record<string, JsonObject> = {};
  for (const ref of modelRefs(ctx.config)) {
    for (const slot of [undefined, ...slots]) {
      const opts = slot ? { credentialSlot: slot } : undefined;
      try {
        const g = ctx.providers.generation(ref, opts);
        providers[providerKey("generation", ref, slot)] = {
          id: g.id,
          model: g.model,
          capabilities: g.capabilities,
        };
      } catch {
        /* not a generation model */
      }
      try {
        const e = ctx.providers.embedding(ref, opts);
        providers[providerKey("embedding", ref, slot)] = {
          id: e.id,
          model: e.model,
          dimensions: e.dimensions,
        };
      } catch {
        /* not an embedding model */
      }
    }
  }
  return {
    run: ctx.run,
    node: ctx.node,
    config: ctx.config,
    vars: ctx.vars,
    scope: ctx.scope,
    budget: { ...ctx.budget },
    ...(ctx.resume ? { resume: ctx.resume } : {}),
    credentialSlots: slots.filter((s) => ctx.credentials.has(s)),
    providers,
    sandbox: ctx.sandbox !== undefined,
  };
}

/** The package with every node's `execute` running in the host. */
export function hostedPackage(pkg: NodePackage, host: PluginHost): NodePackage {
  return {
    ...pkg,
    nodes: pkg.nodes.map((def) => ({
      ...def,
      execute: (ctx: ExecutionContext, input: JsonObject) => host.execute(def, ctx, input),
    })),
  };
}
