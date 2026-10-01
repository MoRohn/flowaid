/**
 * A hostile plugin for the isolation tests: each probe tries one way out of the plugin host and
 * reports what stopped it (`outcome` is "allowed" when nothing did).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { z } from "zod";
import { defineNode, ok } from "@flowaid/node-sdk";

type Probe = () => unknown;

/** Dynamic specifiers keep bundlers and the type checker away from what the probes import. */
const load = (specifier: string): Promise<unknown> => import(specifier);

const PROBES: Record<string, (path: string) => Probe> = {
  read: (path) => () => readFileSync(path, "utf8").length,
  write: (path) => () => writeFileSync(path, "pwned"),
  importChildProcess: () => () => load("node:child_process"),
  importNet: () => () => load("node:net"),
  importHttp: () => () => load("http"),
  importModule: () => () => load("node:module"),
  importWorker: () => () => load("node:worker_threads"),
  importVm: () => () => load("vm"),
  getBuiltinChildProcess: () => () => process.getBuiltinModule("node:child_process"),
  getBuiltinNet: () => () => process.getBuiltinModule("net"),
  fetch: () => () => fetch("http://127.0.0.1:9/"),
  binding: () => () =>
    (process as unknown as { binding(name: string): unknown }).binding("tcp_wrap"),
  killWorker: () => () => process.kill(process.ppid, 0),
  commonjsRequire: () => () => load(new URL("./require.cjs", import.meta.url).href),
  commonjsLoad: () => async () => {
    const legacy = (await load(new URL("./load.cjs", import.meta.url).href)) as {
      default: { viaLoad(): unknown };
    };
    return legacy.default.viaLoad();
  },
  allowedBuiltin: () => () => load("node:crypto"),
};

export const probe = defineNode({
  id: "hostile-plugin.probe",
  version: "1.0.0",
  metadata: {
    name: "Probe",
    description: "Tries one way out of the plugin host",
    category: "developer",
    icon: "flask-conical",
    tags: ["test"],
  },
  configSchema: z.strictObject({ probe: z.string(), path: z.string().default("") }),
  inputSchema: z.object({}),
  outputSchema: z.object({ outcome: z.string(), detail: z.string() }),
  capabilities: [],
  idempotency: "safe",
  execute: async (ctx) => {
    const make = PROBES[ctx.config.probe];
    if (!make) return ok({ outcome: "unknown probe", detail: ctx.config.probe });
    try {
      await make(ctx.config.path)();
      return ok({ outcome: "allowed", detail: "" });
    } catch (error) {
      const e = error as { code?: string; message?: string };
      return ok({ outcome: e.code ?? "error", detail: e.message ?? String(error) });
    }
  },
});

/** What the runtime's permission model reports for this process. */
export const permissions = defineNode({
  id: "hostile-plugin.permissions",
  version: "1.0.0",
  metadata: {
    name: "Permissions",
    description: "Reports the permission model's answers",
    category: "developer",
    icon: "flask-conical",
    tags: ["test"],
  },
  configSchema: z.strictObject({ path: z.string() }),
  inputSchema: z.object({}),
  outputSchema: z.object({
    enabled: z.boolean(),
    read: z.boolean(),
    write: z.boolean(),
    child: z.boolean(),
    worker: z.boolean(),
  }),
  capabilities: [],
  idempotency: "safe",
  execute: (ctx) => {
    const p = (
      process as unknown as {
        permission?: { has(scope: string, reference?: string): boolean };
      }
    ).permission;
    return Promise.resolve(
      ok({
        enabled: p !== undefined,
        read: p?.has("fs.read", ctx.config.path) ?? true,
        write: p?.has("fs.write", ctx.config.path) ?? true,
        child: p?.has("child") ?? true,
        worker: p?.has("worker") ?? true,
      }),
    );
  },
});

export const nodes = [probe, permissions];
