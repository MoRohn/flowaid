import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { plugins } from "@flowaid/database";
import { describeDb } from "@flowaid/database/testing";
import { packTarball } from "@flowaid/plugins";
import { startFakeRegistry, type FakeRegistry } from "@flowaid/plugins/testing";
import { uuidv7 } from "@flowaid/shared";
import type { NodeManifest } from "@flowaid/workflow-core";
import { call, createTestApp, login, type Jar, type TestApp } from "./test/app.js";

const CORE = JSON.parse(
  readFileSync(join(import.meta.dirname, "../../../packages/nodes-core/manifest.json"), "utf8"),
) as { nodes: NodeManifest[] };
const template = CORE.nodes.find((m) => m.id === "flowaid.data.template") as NodeManifest;
const manifest = (pkg: string) => JSON.stringify({ nodes: [{ ...template, id: `${pkg}.echo` }] });

describeDb("plugins: install, discovery and management (Postgres)", () => {
  let t: TestApp;
  let jar: Jar;
  let reg: FakeRegistry;
  let bundledId: string;
  beforeAll(async () => {
    reg = await startFakeRegistry();
    await reg.publish({
      name: "@acme/nodes-crm",
      version: "1.0.0",
      description: "CRM lookups",
      flowaid: { package: "nodePackage", sdk: "^0.1.0" },
      files: { "manifest.json": manifest("@acme/nodes-crm") },
    });
    await reg.publish({
      name: "@acme/tampered",
      version: "1.0.0",
      flowaid: { sdk: "^0.1.0" },
      files: { "manifest.json": manifest("@acme/tampered") },
      tamper: await packTarball({ "package.json": "{}" }),
    });
    await reg.publish({
      name: "@evil/nodes",
      version: "1.0.0",
      description: "CRM too",
      flowaid: { sdk: "^0.1.0" },
      files: { "manifest.json": manifest("@evil/nodes") },
    });
    t = await createTestApp({
      plugins: { allowList: ["@acme"], registry: reg.url, allowLocal: false },
    });
    jar = await login(t.app);
    bundledId = uuidv7();
    await t.db.app.system((tx) =>
      tx.insert(plugins).values({
        id: bundledId,
        workspaceId: null,
        packageName: "@flowaid/nodes-langchain",
        version: "0.1.0",
        source: "bundled",
        integrity: "0.1.0",
        manifests: [],
        status: "enabled",
      }),
    );
  });
  afterAll(async () => {
    await t.close();
    await reg.close();
  });

  it("installs an allowed package from the registry and serves its nodes", async () => {
    const res = await call(t.app, jar, "POST", "/v1/plugins", { packageName: "@acme/nodes-crm" });
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json()).toMatchObject({
      workerRestartRequired: true,
      plugin: {
        packageName: "@acme/nodes-crm",
        version: "1.0.0",
        source: "npm",
        status: "enabled",
        scope: "workspace",
        nodes: [{ id: "@acme/nodes-crm.echo" }],
      },
    });
    expect(res.json().plugin.integrity).toMatch(/^sha512-/);
    const nodes = (await call(t.app, jar, "GET", "/v1/nodes")).json() as NodeManifest[];
    expect(nodes.some((n) => n.id === "@acme/nodes-crm.echo")).toBe(true);
    const list = (await call(t.app, jar, "GET", "/v1/plugins")).json() as {
      packageName: string;
      scope: string;
    }[];
    expect(list.map((p) => `${p.packageName}:${p.scope}`).sort()).toEqual([
      "@acme/nodes-crm:workspace",
      "@flowaid/nodes-langchain:global",
    ]);
    const audit = (await call(t.app, jar, "GET", "/v1/audit?action=plugin.install")).json() as {
      items: { details: { integrity?: string } }[];
    };
    expect(audit.items[0]?.details.integrity).toMatch(/^sha512-/);
  });

  it("refuses packages outside the allow-list, tampered tarballs, pinned mismatches and local installs", async () => {
    const outside = await call(t.app, jar, "POST", "/v1/plugins", { packageName: "@evil/nodes" });
    expect(outside.statusCode).toBe(403);
    expect(outside.json().error.details.reason).toBe("E_PLUGIN_NOT_ALLOWED");
    const tampered = await call(t.app, jar, "POST", "/v1/plugins", {
      packageName: "@acme/tampered",
    });
    expect(tampered.statusCode).toBe(422);
    expect(tampered.json().error.details.reason).toBe("E_PLUGIN_INTEGRITY");
    const frozen = await call(t.app, jar, "POST", "/v1/plugins", {
      packageName: "@acme/nodes-crm",
      integrity: "sha512-somethingelse",
    });
    expect(frozen.json().error.details.reason).toBe("E_PLUGIN_INTEGRITY");
    const local = await call(t.app, jar, "POST", "/v1/plugins", {
      packageName: "@acme/nodes-crm",
      source: "local",
      path: "/tmp",
    });
    expect(local.statusCode).toBe(403);
    expect(
      (await call(t.app, jar, "POST", "/v1/plugins", { packageName: "@acme/missing" })).statusCode,
    ).toBe(404);
  });

  it("searches the registry, marking allowed and installed packages", async () => {
    const res = await call(t.app, jar, "GET", "/v1/plugins/search?q=crm");
    expect(res.statusCode).toBe(200);
    const byName = Object.fromEntries(
      (res.json() as { name: string; allowed: boolean; installed: string | null }[]).map((r) => [
        r.name,
        r,
      ]),
    );
    expect(byName["@acme/nodes-crm"]).toMatchObject({ allowed: true, installed: "1.0.0" });
    expect(byName["@evil/nodes"]).toMatchObject({ allowed: false, installed: null });
  });

  it("disables, re-enables and removes a workspace plugin; bundled rows only toggle", async () => {
    const list = (await call(t.app, jar, "GET", "/v1/plugins")).json() as {
      id: string;
      packageName: string;
    }[];
    const crm = list.find((p) => p.packageName === "@acme/nodes-crm")?.id as string;
    const off = await call(t.app, jar, "PATCH", `/v1/plugins/${crm}`, { status: "disabled" });
    expect(off.json().plugin.status).toBe("disabled");
    const nodes = (await call(t.app, jar, "GET", "/v1/nodes")).json() as NodeManifest[];
    expect(nodes.some((n) => n.id === "@acme/nodes-crm.echo")).toBe(false);

    expect(
      (await call(t.app, jar, "PATCH", `/v1/plugins/${bundledId}`, { pool: "code" })).statusCode,
    ).toBe(400);
    expect((await call(t.app, jar, "DELETE", `/v1/plugins/${bundledId}`)).statusCode).toBe(409);
    const bundledOff = await call(t.app, jar, "PATCH", `/v1/plugins/${bundledId}`, {
      status: "disabled",
    });
    expect(bundledOff.json().plugin).toMatchObject({ status: "disabled", scope: "global" });
    expect((await call(t.app, jar, "GET", "/v1/me")).json().features.langchain).toBe(false);

    expect((await call(t.app, jar, "DELETE", `/v1/plugins/${crm}`)).statusCode).toBe(204);
    const after = (await call(t.app, jar, "GET", "/v1/plugins")).json() as {
      packageName: string;
    }[];
    expect(after.map((p) => p.packageName)).toEqual(["@flowaid/nodes-langchain"]);
  });

  it("requires admin to install", async () => {
    const key = (
      await call(t.app, jar, "POST", "/v1/api-keys", { name: "reader", scopes: ["tools:read"] })
    ).json().key as string;
    const res = await t.app.inject({
      method: "POST",
      url: "/v1/plugins",
      headers: { authorization: `Bearer ${key}` },
      payload: { packageName: "@acme/nodes-crm" },
    });
    expect(res.statusCode).toBe(403);
    expect((await call(t.app, jar, "GET", "/v1/me")).json().features.integrations_plugins).toBe(
      true,
    );
  });

  it("records where a local install lives, for the worker to load it from", async () => {
    const dir = mkdtempSync(join(tmpdir(), "flowaid-local-"));
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({
        name: "@acme/local-nodes",
        version: "0.3.0",
        keywords: ["flowaid-node"],
        flowaid: { sdk: "^0.1.0" },
      }),
    );
    writeFileSync(join(dir, "manifest.json"), manifest("@acme/local-nodes"));
    const config = t.ctx.config.plugins as { allowLocal: boolean };
    config.allowLocal = true;
    try {
      const res = await call(t.app, jar, "POST", "/v1/plugins", {
        packageName: "@acme/local-nodes",
        source: "local",
        path: dir,
      });
      expect(res.statusCode).toBe(201);
      const [row] = await t.db.app.system((tx) =>
        tx
          .select()
          .from(plugins)
          .where(eq(plugins.id, res.json().plugin.id as string)),
      );
      expect(row).toMatchObject({ source: "local", location: dir, version: "0.3.0" });
    } finally {
      config.allowLocal = false;
    }
  });
});
