import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { plugins } from "@flowaid/database";
import { describeDb } from "@flowaid/database/testing";
import { defineNode, ok, toManifest } from "@flowaid/node-sdk";
import { RegistryClient, resolvePlugin } from "@flowaid/plugins";
import { startFakeRegistry, type FakeRegistry } from "@flowaid/plugins/testing";
import { uuidv7 } from "@flowaid/shared";
import type { PluginHost } from "./plugins/host.js";
import { loadInstalledPlugins } from "./plugins/installed.js";
import { createHarness, type Harness } from "./test/setup.js";

/** The plugin's published source: plain ESM that imports what the platform provides. */
const SOURCE = `
import { z } from "zod";
import { defineNode, ok } from "@flowaid/node-sdk";
export const node = defineNode({
  id: "@acme/weather.forecast",
  version: "1.0.0",
  metadata: { name: "Forecast", description: "A canned forecast", category: "developer", icon: "cloud", tags: [] },
  configSchema: z.strictObject({ unit: z.enum(["c", "f"]).default("c") }),
  inputSchema: z.object({ city: z.string() }),
  outputSchema: z.object({ summary: z.string(), pid: z.number() }),
  capabilities: [],
  idempotency: "safe",
  execute: async (ctx, input) => {
    ctx.logger.info("forecasting", { city: input.city });
    return ok({ summary: input.city + ": sunny, 21" + ctx.config.unit, pid: process.pid });
  },
});
`;

/** The same node as the test's own definition, to produce the manifest the package ships. */
const forecast = defineNode({
  id: "@acme/weather.forecast",
  version: "1.0.0",
  metadata: {
    name: "Forecast",
    description: "A canned forecast",
    category: "developer",
    icon: "cloud",
    tags: [],
  },
  configSchema: z.strictObject({ unit: z.enum(["c", "f"]).default("c") }),
  inputSchema: z.object({ city: z.string() }),
  outputSchema: z.object({ summary: z.string(), pid: z.number() }),
  capabilities: [],
  idempotency: "safe",
  execute: () => Promise.resolve(ok({ summary: "", pid: 0 })),
});
const MANIFEST = JSON.stringify([toManifest(forecast)]);

const silent = { info: () => undefined, warn: () => undefined, error: () => undefined };

/** The platform packages a local directory resolves by itself (an operator's `npm install`). */
function linkProvided(dir: string) {
  const worker = dirname(dirname(fileURLToPath(import.meta.url)));
  const sdk = realpathSync(join(worker, "node_modules", "@flowaid", "node-sdk"));
  for (const [name, target] of [
    ["@flowaid/node-sdk", sdk],
    ["zod", realpathSync(join(sdk, "node_modules", "zod"))],
  ] as const) {
    mkdirSync(dirname(join(dir, "node_modules", name)), { recursive: true });
    symlinkSync(target, join(dir, "node_modules", name), "dir");
  }
}

function localPackage(name: string, extra: Record<string, unknown> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), "flowaid-local-plugin-"));
  const source = SOURCE.replaceAll("@acme/weather", name);
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name, version: "0.2.0", type: "module", main: "index.js", ...extra }),
  );
  writeFileSync(join(dir, "index.js"), source);
  linkProvided(dir);
  return dir;
}

describeDb("installed plugins (Postgres)", () => {
  let h: Harness;
  let registry: FakeRegistry;
  const pluginDir = mkdtempSync(join(tmpdir(), "flowaid-plugins-"));
  const hosts: PluginHost[] = [];
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    registry = await startFakeRegistry();
    for (const name of ["@acme/weather", "@acme/tamper"])
      await registry.publish({
        name,
        version: "1.2.0",
        flowaid: { sdk: "^0.1.0" },
        files: {
          "index.js": SOURCE.replaceAll("@acme/weather", name),
          "manifest.json": MANIFEST.replaceAll("@acme/weather", name),
        },
      });
    const client = new RegistryClient({ registry: registry.url });
    h = await createHarness({
      prepare: async (db, workspaceId) => {
        // what POST /v1/plugins records: a verified resolution
        const resolved = await resolvePlugin("@acme/weather", {
          registry: client,
          allowList: ["*"],
        });
        const tamper = await resolvePlugin("@acme/tamper", { registry: client, allowList: ["*"] });
        const local = localPackage("@acme/local");
        const needsDeps = localPackage("@acme/deps", { dependencies: { "left-pad": "^1.3.0" } });
        const row = (packageName: string, v: Partial<typeof plugins.$inferInsert>) => {
          ids[packageName] = uuidv7();
          return {
            id: ids[packageName],
            workspaceId,
            packageName,
            version: "1.2.0",
            source: "npm" as const,
            status: "enabled" as const,
            manifests: resolved.manifests,
            ...v,
          };
        };
        await db.app.system((tx) =>
          tx.insert(plugins).values([
            row("@acme/weather", { integrity: resolved.integrity }),
            // recorded integrity differs from what the registry now serves
            row("@acme/tamper", {
              integrity: resolved.integrity,
              manifests: tamper.manifests,
            }),
            row("@acme/local", {
              source: "local",
              version: "0.2.0",
              integrity: "local:x",
              location: local,
              manifests: JSON.parse(MANIFEST.replaceAll("@acme/weather", "@acme/local")) as never,
            }),
            row("@acme/deps", {
              source: "local",
              version: "0.2.0",
              integrity: "local:y",
              location: needsDeps,
              manifests: JSON.parse(MANIFEST.replaceAll("@acme/weather", "@acme/deps")) as never,
            }),
          ]),
        );
        const loaded = await loadInstalledPlugins({
          db: db.app,
          registry: client,
          pluginDir,
          log: silent,
        });
        hosts.push(...loaded.hosts);
        const manifests = (await db.app.system((tx) => tx.select().from(plugins))).flatMap(
          (r) => r.manifests,
        );
        return { nodes: loaded.packages, manifests };
      },
    });
  }, 120_000);
  afterAll(async () => {
    await Promise.all(hosts.map((x) => x.stop()));
    await h.close();
    await registry.close();
  });

  it("extracts the verified tarball into the plugin directory with the provided packages linked", () => {
    const dir = join(pluginDir, "@acme/weather", "1.2.0");
    expect(readFileSync(join(dir, "index.js"), "utf8")).toContain("@acme/weather.forecast");
    expect(existsSync(join(dir, ".flowaid-package.tgz"))).toBe(true);
    expect(existsSync(join(dir, "node_modules", "@flowaid", "node-sdk"))).toBe(true);
    expect(hosts.map((x) => x.restarts)).toEqual([0, 0]);
  });

  it("runs a workflow whose plugin node executes in the host process", async () => {
    for (const name of ["@acme/weather", "@acme/local"]) {
      const { workflowId, versionId } = await h.deploy(`Forecast ${name}`, {
        inputs: { type: "object", properties: { city: { type: "string" } }, required: ["city"] },
        outputs: {
          type: "object",
          properties: { summary: { type: "string" }, pid: { type: "number" } },
        },
        nodes: [
          { id: "start", kind: "input", name: "Start" },
          {
            id: "fc",
            kind: "task",
            name: "Forecast",
            type: `${name}.forecast`,
            typeVersion: "1.0.0",
            config: { unit: "f" },
            inputs: { city: { kind: "ref", ref: { kind: "port", node: "start", port: "city" } } },
          },
          {
            id: "end",
            kind: "output",
            name: "End",
            value: {
              kind: "object",
              fields: {
                summary: { kind: "ref", ref: { kind: "port", node: "fc", port: "summary" } },
                pid: { kind: "ref", ref: { kind: "port", node: "fc", port: "pid" } },
              },
            },
          },
        ],
        edges: [
          { id: "e1", from: { node: "start", port: "done" }, to: { node: "fc" } },
          { id: "e2", from: { node: "fc", port: "done" }, to: { node: "end" } },
        ],
      });
      const runId = await h.start(workflowId, versionId, { city: "Oslo" });
      const run = await h.waitFor(runId, ["completed"]);
      const out = run.output as { summary: string; pid: number };
      expect(out.summary, name).toBe("Oslo: sunny, 21f");
      expect(out.pid, name).not.toBe(process.pid);
    }
  }, 60_000);

  it("records load failures on their rows and keeps the worker running", async () => {
    const rows = await h.db.app.system((tx) => tx.select().from(plugins));
    const by = (name: string) => rows.find((r) => r.id === ids[name]);
    expect(by("@acme/weather")).toMatchObject({ status: "enabled", error: null });
    expect(by("@acme/local")).toMatchObject({ status: "enabled", error: null });
    expect(by("@acme/tamper")?.status).toBe("error");
    expect(by("@acme/tamper")?.error).toMatch(/^E_PLUGIN_INTEGRITY/);
    expect(by("@acme/deps")?.status).toBe("error");
    expect(by("@acme/deps")?.error).toMatch(/^E_PLUGIN_DEPENDENCIES: .*left-pad/);
    await h.db.app.system((tx) =>
      tx
        .update(plugins)
        .set({ status: "disabled" })
        .where(eq(plugins.id, ids["@acme/deps"] ?? "")),
    );
  });

  it("reuses a verified extraction on the next boot without downloading", async () => {
    const before = registry.requests.filter((r) => r.includes("/-/tarballs/")).length;
    const again = await loadInstalledPlugins({
      db: h.db.app,
      registry: new RegistryClient({ registry: registry.url }),
      pluginDir,
      log: silent,
    });
    try {
      expect(again.packages.map((p) => p.name).sort()).toEqual(["@acme/local", "@acme/weather"]);
      const tarballs = registry.requests.filter((r) => r.includes("/-/tarballs/"));
      // the tampered row is in error (not retried) and the good one is reused
      expect(tarballs.length - before).toBe(0);
    } finally {
      await Promise.all(again.hosts.map((x) => x.stop()));
    }
  }, 60_000);
});
