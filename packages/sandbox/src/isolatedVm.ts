/**
 * `IsolatedVmSandbox` (ARCHITECTURE.md §10.7): one isolate per run (`memoryLimit`, no inspector,
 * no `require`, no Node globals), a CPU timeout equal to the node timeout and a wall-clock deadline
 * `min(timeout, 120 s)` that disposes the isolate, and host bridges for `fetch`, `log`, `tools.call`
 * and `state.get/set` — each value crossing capped at 4 MiB. `isolated-vm` is an optional native
 * dependency loaded on first use; without a build for this Node version runs fail with
 * `SANDBOX_UNAVAILABLE` (use Node 24 or `SANDBOX_MODE=container`).
 */
import {
  SandboxError,
  toFlowaidError,
  type JsonValue,
  type SandboxBridges,
  type SandboxExecutor,
  type SandboxLogLine,
  type SandboxRunRequest,
  type SandboxRunResult,
} from "@flowaid/workflow-core";
import { SANDBOX_LIMITS } from "./limits.js";
import type IvmModule from "isolated-vm";
import { ENTRY, transpile } from "./transpile.js";
import { validateOutput } from "./validate.js";

type Ivm = typeof IvmModule;
let loaded: Promise<Ivm> | undefined;

/** Loads isolated-vm once; rejects with SANDBOX_UNAVAILABLE when there is no native build. */
export function loadIsolatedVm(): Promise<Ivm> {
  loaded ??= import("isolated-vm")
    .then((m) => (m as { default?: Ivm }).default ?? (m as unknown as Ivm))
    .catch((error: unknown) => {
      loaded = undefined;
      throw new SandboxError(
        `SANDBOX_UNAVAILABLE: isolated-vm could not be loaded on Node ${process.versions.node} (${error instanceof Error ? error.message.split("\n")[0] : String(error)}); run the code pool on Node 24 or set SANDBOX_MODE=container`,
      );
    });
  return loaded;
}

export async function isolatedVmAvailable(): Promise<boolean> {
  try {
    await loadIsolatedVm();
    return true;
  } catch {
    return false;
  }
}

const bytes = (s: string) => Buffer.byteLength(s);
function capped(json: string, what: string): string {
  if (bytes(json) > SANDBOX_LIMITS.bridgeBytes)
    throw new SandboxError(`${what} is larger than ${SANDBOX_LIMITS.bridgeBytes} bytes`);
  return json;
}

/** Runs inside the isolate before the user code: console/log, fetch, tools, state over two host callbacks. */
const PRELUDE = `
const __log = __flowaid_log; const __call = __flowaid_call;
delete globalThis.__flowaid_log; delete globalThis.__flowaid_call;
const __fmt = (a) => a.map((x) => typeof x === "string" ? x : (() => { try { return JSON.stringify(x); } catch { return String(x); } })()).join(" ");
const __host = async (op, payload) => {
  const r = JSON.parse(await __call.apply(undefined, [op, JSON.stringify(payload === undefined ? null : payload)], { arguments: { copy: true }, result: { promise: true, copy: true } }));
  if (r.error) throw new Error(r.error);
  return r.value;
};
globalThis.console = Object.freeze({
  log: (...a) => __log("info", __fmt(a)), info: (...a) => __log("info", __fmt(a)),
  debug: (...a) => __log("debug", __fmt(a)), warn: (...a) => __log("warn", __fmt(a)), error: (...a) => __log("error", __fmt(a)),
});
globalThis.log = globalThis.console.log;
globalThis.fetch = async (url, init = {}) => {
  const r = await __host("fetch", { url: String(url), method: init.method ?? "GET", headers: init.headers ?? {}, body: init.body ?? null });
  return { ok: r.status >= 200 && r.status < 300, status: r.status, headers: r.headers, text: async () => r.body, json: async () => JSON.parse(r.body) };
};
globalThis.tools = Object.freeze({ call: (name, args) => __host("tool", { name, args: args ?? {} }) });
globalThis.state = Object.freeze({ get: (key) => __host("stateGet", { key }), set: (key, value) => __host("stateSet", { key, value }) });
`;

export interface IsolatedVmOptions {
  /** default heap in MiB (128) */
  memoryMb?: number;
}

export class IsolatedVmSandbox implements SandboxExecutor {
  readonly kind = "isolated-vm" as const;
  constructor(private readonly opts: IsolatedVmOptions = {}) {}

  async run(req: SandboxRunRequest, bridges: SandboxBridges): Promise<SandboxRunResult> {
    const ivm = await loadIsolatedVm();
    const started = performance.now();
    const js = await transpile(req.code, req.language);
    const inputsJson = capped(JSON.stringify(req.inputs ?? {}), "inputs");
    const logs: SandboxLogLine[] = [];
    let dropped = 0;
    const isolate = new ivm.Isolate({
      memoryLimit: req.memoryMb ?? this.opts.memoryMb ?? SANDBOX_LIMITS.memoryMb,
      inspector: false,
    });
    const deadlineMs = Math.min(req.timeoutMs, SANDBOX_LIMITS.maxWallClockMs);
    let disposedBy: "deadline" | "cancel" | null = null;
    const dispose = (why: "deadline" | "cancel") => {
      if (isolate.isDisposed) return;
      disposedBy = why;
      isolate.dispose();
    };
    const timer = setTimeout(() => dispose("deadline"), deadlineMs);
    const onAbort = () => dispose("cancel");
    bridges.signal.addEventListener("abort", onAbort, { once: true });
    try {
      if (bridges.signal.aborted)
        throw new SandboxError("the run was cancelled before the code started");
      const context = await isolate.createContext();
      const jail = context.global;
      await jail.set("globalThis", jail.derefInto());
      await jail.set(
        "__flowaid_log",
        new ivm.Callback((level: string, message: string) => {
          if (logs.length >= SANDBOX_LIMITS.logLines) {
            dropped++;
            return;
          }
          const text = String(message);
          const lvl = (
            ["debug", "info", "warn", "error"].includes(level) ? level : "info"
          ) as SandboxLogLine["level"];
          logs.push({
            level: lvl,
            message:
              bytes(text) > SANDBOX_LIMITS.logLineBytes
                ? `${Buffer.from(text).subarray(0, SANDBOX_LIMITS.logLineBytes).toString("utf8")}…`
                : text,
          });
        }),
      );
      await jail.set(
        "__flowaid_call",
        new ivm.Reference(async (op: string, payloadJson: string) => {
          try {
            const payload = JSON.parse(
              capped(String(payloadJson), `the ${op} arguments`),
            ) as Record<string, JsonValue>;
            const value = await hostCall(op, payload, bridges);
            return capped(JSON.stringify({ value: value ?? null }), `the ${op} result`);
          } catch (error) {
            return JSON.stringify({ error: toFlowaidError(error).message });
          }
        }),
      );
      await context.eval(PRELUDE, { timeout: 1000 });
      const resultJson = (await context.evalClosure(
        `${js}\nreturn ${ENTRY}(JSON.parse($0)).then((r) => JSON.stringify(r === undefined ? null : r));`,
        [inputsJson],
        { timeout: req.timeoutMs, result: { promise: true, copy: true } },
      )) as string;
      const output = JSON.parse(capped(resultJson, "the return value")) as JsonValue;
      validateOutput(req.outputSchema, output);
      if (dropped > 0)
        logs.push({
          level: "warn",
          message: `${dropped} log lines dropped (limit ${SANDBOX_LIMITS.logLines})`,
        });
      return { output, logs, durationMs: Math.round(performance.now() - started) };
    } catch (error) {
      throw mapError(
        error,
        disposedBy,
        deadlineMs,
        req.memoryMb ?? this.opts.memoryMb ?? SANDBOX_LIMITS.memoryMb,
        logs,
      );
    } finally {
      clearTimeout(timer);
      bridges.signal.removeEventListener("abort", onAbort);
      if (!isolate.isDisposed) isolate.dispose();
    }
  }
}

const text = (v: JsonValue | undefined): string =>
  typeof v === "string" ? v : v === undefined || v === null ? "" : JSON.stringify(v);

async function hostCall(
  op: string,
  p: Record<string, JsonValue>,
  bridges: SandboxBridges,
): Promise<JsonValue> {
  switch (op) {
    case "fetch": {
      if (!bridges.fetch)
        throw new SandboxError("network access is off for this code (allowNetwork is false)");
      const headers = (p.headers ?? {}) as Record<string, string>;
      const res = await bridges.fetch(text(p.url), {
        method: text(p.method ?? "GET"),
        headers,
        ...(p.body !== null && p.body !== undefined
          ? { body: typeof p.body === "string" ? p.body : JSON.stringify(p.body) }
          : {}),
        maxBytes: SANDBOX_LIMITS.bridgeBytes,
      });
      const body = await res.text();
      const out: Record<string, string> = {};
      res.headers.forEach((v, k) => (out[k] = v));
      return { status: res.status, headers: out, body };
    }
    case "tool":
      if (!bridges.callTool)
        throw new SandboxError(`tools.call is not available: config.tools is empty`);
      return bridges.callTool(text(p.name), p.args ?? {});
    case "stateGet":
      if (!bridges.stateGet) throw new SandboxError("state is not available");
      return bridges.stateGet(text(p.key));
    case "stateSet":
      if (!bridges.stateSet) throw new SandboxError("state is not available");
      await bridges.stateSet(text(p.key), p.value ?? null);
      return null;
    default:
      throw new SandboxError(`unknown host call ${op}`);
  }
}

function mapError(
  error: unknown,
  disposedBy: "deadline" | "cancel" | null,
  deadlineMs: number,
  memoryMb: number,
  logs: SandboxLogLine[],
): Error {
  const message = error instanceof Error ? error.message : String(error);
  const details = { logs: logs.slice(-20) as unknown as JsonValue };
  if (
    error instanceof SandboxError ||
    (error as { code?: string }).code === "SCHEMA_VALIDATION_ERROR"
  )
    return error as Error;
  if (disposedBy === "deadline")
    return new SandboxError(`the code exceeded its ${deadlineMs} ms wall-clock deadline`, details);
  if (disposedBy === "cancel") return new SandboxError("the run was cancelled", details);
  if (/memory limit/i.test(message))
    return new SandboxError(`the code exceeded its ${memoryMb} MiB memory limit`, details);
  if (/timed out/i.test(message))
    return new SandboxError("the code exceeded its CPU time limit", details);
  return new SandboxError(`the code threw: ${message.slice(0, 2000)}`, details);
}
