/**
 * Plugin isolation: a hostile plugin in a real plugin host process (started exactly as the worker
 * starts it: the development bundle under the Node permission model) cannot read or write files
 * outside its directory, spawn a process, start a worker thread, open a socket or signal the
 * worker; `ctx.http` remains its way to the network. A bare process started with the host's
 * flags proves the runtime itself (not only the in-process guard) refuses child processes.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ExecutionContext } from "@flowaid/node-sdk";
import type { JsonObject } from "@flowaid/workflow-core";
import { PluginGuardError, builtinAllowed } from "./guard.js";
import { PERMISSION_COVERS_NETWORK, PluginHost, hostExecArgv } from "./host.js";

const silent = { info: () => undefined, warn: () => undefined, error: () => undefined };
const HOSTILE = fileURLToPath(new URL("./test/hostile/index.ts", import.meta.url));
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");

function context(config: JsonObject): ExecutionContext {
  return {
    run: { id: "r1", workspaceId: "w1" },
    node: { id: "n1", nodeRunId: "nr1" },
    config,
    vars: {},
    scope: {},
    signal: new AbortController().signal,
    logger: {
      debug: () => undefined,
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
    },
    credentials: { has: () => false, get: () => Promise.resolve({}) },
    providers: {},
    tools: {},
    state: {},
    artifacts: {},
    events: { emit: () => undefined, stream: () => undefined },
    budget: { remainingCostUsd: null, remainingTokens: null, remainingMs: 10_000 },
    http: () => Promise.resolve(new Response("ok")),
    clock: { now: () => new Date() },
  } as unknown as ExecutionContext;
}

describe("plugin isolation", () => {
  const host = new PluginHost({
    packageName: "hostile-plugin",
    version: "1.0.0",
    modulePath: HOSTILE,
    log: silent,
  });
  let outside = "";
  let secret = "";

  beforeAll(() => {
    outside = realpathSync(mkdtempSync(join(tmpdir(), "flowaid-isolation-")));
    secret = join(outside, "master.key");
    writeFileSync(secret, "not for plugins");
  });
  afterAll(async () => {
    await host.stop();
    rmSync(outside, { recursive: true, force: true });
  });

  const probe = async (name: string, path = "") => {
    const r = await host.execute(
      { id: "hostile-plugin.probe", version: "1.0.0" } as never,
      context({ probe: name, path }),
      {},
    );
    expect(r.kind).toBe("ok");
    return (r as unknown as { output: { outcome: string; detail: string } }).output;
  };

  it("runs under the permission model: no reads outside, no writes, no processes, no workers", async () => {
    const r = await host.execute(
      { id: "hostile-plugin.permissions", version: "1.0.0" } as never,
      context({ path: secret }),
      {},
    );
    expect(r).toMatchObject({
      kind: "ok",
      output: { enabled: true, read: false, write: false, child: false, worker: false },
    });
  }, 60_000);

  it("cannot read a file outside its directory, nor the repository root", async () => {
    expect(await probe("read", secret)).toMatchObject({ outcome: "ERR_ACCESS_DENIED" });
    expect(await probe("read", join(REPO_ROOT, "package.json"))).toMatchObject({
      outcome: "ERR_ACCESS_DENIED",
    });
    expect(await probe("read", "/etc/hosts")).toMatchObject({ outcome: "ERR_ACCESS_DENIED" });
    // its own files stay readable
    expect(await probe("read", HOSTILE)).toMatchObject({ outcome: "allowed" });
  }, 30_000);

  it("cannot write anywhere, its own directory included", async () => {
    expect(await probe("write", join(outside, "x"))).toMatchObject({
      outcome: "ERR_ACCESS_DENIED",
    });
    expect(await probe("write", join(dirname(HOSTILE), "x"))).toMatchObject({
      outcome: "ERR_ACCESS_DENIED",
    });
  }, 30_000);

  it("cannot reach child processes, worker threads or the module loader", async () => {
    for (const name of [
      "importChildProcess",
      "getBuiltinChildProcess",
      "importWorker",
      "importModule",
      "importVm",
    ])
      expect(await probe(name), name).toMatchObject({ outcome: "E_PLUGIN_BUILTIN_DENIED" });
  }, 30_000);

  it("cannot open sockets directly; the network is ctx.http", async () => {
    for (const name of [
      "importNet",
      "importHttp",
      "getBuiltinNet",
      "commonjsRequire",
      "commonjsLoad",
    ])
      expect(await probe(name), name).toMatchObject({
        outcome: "E_PLUGIN_BUILTIN_DENIED",
        detail: expect.stringContaining("ctx.http") as unknown as string,
      });
    expect(await probe("fetch")).toMatchObject({ outcome: "E_PLUGIN_NETWORK_DENIED" });
    // the raw bindings are the permission model's
    expect(await probe("binding")).toMatchObject({ outcome: "ERR_ACCESS_DENIED" });
  }, 30_000);

  it("cannot signal the worker, and keeps the built-ins it needs", async () => {
    expect(await probe("killWorker")).toMatchObject({ outcome: "E_PLUGIN_KILL_DENIED" });
    expect(await probe("allowedBuiltin")).toMatchObject({ outcome: "allowed" });
  }, 30_000);
});

describe("an installed package", () => {
  it("loads from its own directory with the provided packages linked, and stays guarded", async () => {
    // laid out as installed.ts leaves it: plain ESM, the provided packages symlinked in
    const dir = mkdtempSync(join(tmpdir(), "flowaid-installed-plugin-"));
    const worker = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
    const sdk = realpathSync(join(worker, "node_modules", "@flowaid", "node-sdk"));
    for (const [name, target] of [
      ["@flowaid/node-sdk", sdk],
      ["zod", realpathSync(join(sdk, "node_modules", "zod"))],
    ] as const) {
      mkdirSync(dirname(join(dir, "node_modules", name)), { recursive: true });
      symlinkSync(target, join(dir, "node_modules", name), "dir");
    }
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ name: "@acme/probe", version: "1.0.0", type: "module", main: "index.js" }),
    );
    writeFileSync(
      join(dir, "index.js"),
      `import { z } from "zod";
import * as v4 from "zod/v4";
import { defineNode, ok } from "@flowaid/node-sdk";
export const node = defineNode({
  id: "@acme/probe.run",
  version: "1.0.0",
  metadata: { name: "Run", description: "Probe", category: "developer", icon: "cloud", tags: [] },
  configSchema: z.strictObject({}),
  inputSchema: z.object({}),
  outputSchema: z.object({ net: z.string(), subpath: z.boolean() }),
  capabilities: [],
  idempotency: "safe",
  execute: async () => {
    let net = "allowed";
    try { await import("node:net"); } catch (e) { net = e.code; }
    return ok({ net, subpath: typeof v4.object === "function" });
  },
});
`,
    );
    const host = new PluginHost({
      packageName: "@acme/probe",
      version: "1.0.0",
      modulePath: join(dir, "index.js"),
      packageDir: dir,
      log: silent,
    });
    try {
      const r = await host.execute(
        { id: "@acme/probe.run", version: "1.0.0" } as never,
        context({}),
        {},
      );
      expect(r).toMatchObject({
        kind: "ok",
        output: { net: "E_PLUGIN_BUILTIN_DENIED", subpath: true },
      });
    } finally {
      await host.stop();
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});

describe("the host's flags", () => {
  it("make the runtime refuse child processes and reads outside the allow-list", () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "flowaid-flags-")));
    try {
      const script = join(dir, "probe.cjs");
      writeFileSync(
        script,
        [
          "const out = {};",
          'try { require("child_process").spawnSync("true"); out.spawn = "allowed"; } catch (e) { out.spawn = e.code; }',
          'try { new (require("worker_threads").Worker)("1", { eval: true }); out.worker = "allowed"; } catch (e) { out.worker = e.code; }',
          `try { require("fs").readFileSync(${JSON.stringify(join(REPO_ROOT, "package.json"))}); out.read = "allowed"; } catch (e) { out.read = e.code; }`,
          'try { require("fs").writeFileSync(__filename + ".w", "x"); out.write = "allowed"; } catch (e) { out.write = e.code; }',
          'out.net = process.permission.has("net") ? "allowed" : "denied";',
          "console.log(JSON.stringify(out));",
        ].join("\n"),
      );
      const r = spawnSync(process.execPath, [...hostExecArgv([dir], 64), script], {
        encoding: "utf8",
        env: {},
      });
      const out = JSON.parse(r.stdout) as Record<string, string>;
      expect(out).toMatchObject({
        spawn: "ERR_ACCESS_DENIED",
        worker: "ERR_ACCESS_DENIED",
        read: "ERR_ACCESS_DENIED",
        write: "ERR_ACCESS_DENIED",
      });
      // Node 24's permission model has no network scope; Node 25+ withholds --allow-net
      if (PERMISSION_COVERS_NETWORK) expect(out.net).toBe("denied");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("allow-list built-ins by name, with or without node:", () => {
    expect(builtinAllowed("node:crypto")).toBe(true);
    expect(builtinAllowed("stream/promises")).toBe(true);
    for (const name of ["net", "node:tls", "https", "dns", "child_process", "module", "os", "v8"])
      expect(builtinAllowed(name), name).toBe(false);
    expect(new PluginGuardError("E_PLUGIN_BUILTIN_DENIED", "x").code).toBe(
      "E_PLUGIN_BUILTIN_DENIED",
    );
  });
});
