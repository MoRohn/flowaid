import { afterAll, beforeAll, expect, it } from "vitest";
import { plugins } from "@flowaid/database";
import { describeDb } from "@flowaid/database/testing";
import { coreManifests } from "@flowaid/nodes-core/manifest";
import { uuidv7 } from "@flowaid/shared";
import type { NodeManifest } from "@flowaid/workflow-core";
import { call, createTestApp, login, type Jar, type TestApp } from "./test/app.js";

describeDb("enabled plugins join the catalog (Postgres)", () => {
  let t: TestApp;
  let jar: Jar;
  // a plugin node: the core template node under a plugin id
  const template = coreManifests.find((m) => m.id === "flowaid.data.template") as NodeManifest;
  const pluginNode: NodeManifest = { ...template, id: "@flowaid/nodes-langchain.echo" };
  beforeAll(async () => {
    t = await createTestApp();
    jar = await login(t.app);
  });
  afterAll(async () => t.close());

  const definition = (type: string) => ({
    $schema: "https://flowaid.dev/schemas/workflow/v1",
    id: "3e7a1c9b-8d2f-4b6e-9a0c-5f4d3e2b1a09",
    name: "Plugin node",
    inputs: { type: "object", properties: { message: { type: "string" } } },
    outputs: { type: "object", properties: { text: { type: "string" } } },
    nodes: [
      { id: "start", kind: "input", name: "Start" },
      {
        id: "echo",
        kind: "task",
        name: "Echo",
        type,
        typeVersion: template.version,
        config: { template: "hi" },
      },
      {
        id: "end",
        kind: "output",
        name: "End",
        value: {
          kind: "object",
          fields: { text: { kind: "ref", ref: { kind: "port", node: "echo", port: "text" } } },
        },
      },
    ],
    edges: [
      { id: "e1", from: { node: "start", port: "done" }, to: { node: "echo" } },
      { id: "e2", from: { node: "echo", port: "done" }, to: { node: "end" } },
    ],
  });

  it("serves, compiles against and reports enabled plugins only", async () => {
    const before = (await call(t.app, jar, "GET", "/v1/nodes")).json() as NodeManifest[];
    expect(before.some((m) => m.id === pluginNode.id)).toBe(false);
    expect((await call(t.app, jar, "GET", "/v1/me")).json().features.langchain).toBe(false);
    const created = await call(t.app, jar, "POST", "/v1/workflows", {
      name: "Plugin node",
      definition: definition(pluginNode.id),
    });
    expect(created.json().draftDiagnostics.map((d: { code: string }) => d.code)).toContain(
      "E_UNKNOWN_NODE_TYPE",
    );

    await t.db.app.system((tx) =>
      tx.insert(plugins).values({
        id: uuidv7(),
        workspaceId: null,
        packageName: "@flowaid/nodes-langchain",
        version: "0.1.0",
        source: "bundled",
        integrity: "0.1.0",
        manifests: [pluginNode],
        status: "enabled",
      }),
    );
    const res = await call(t.app, jar, "GET", "/v1/nodes");
    expect((res.json() as NodeManifest[]).some((m) => m.id === pluginNode.id)).toBe(true);
    expect(res.headers.etag).not.toBe(undefined);
    expect(
      (await call(t.app, jar, "GET", `/v1/nodes/${encodeURIComponent(pluginNode.id)}`)).statusCode,
    ).toBe(200);
    expect((await call(t.app, jar, "GET", "/v1/me")).json().features.langchain).toBe(true);
    const compiled = await call(
      t.app,
      jar,
      "POST",
      `/v1/workflows/${created.json().id as string}/validate`,
      {},
    );
    expect(
      compiled.json().diagnostics.filter((d: { severity: string }) => d.severity === "error"),
    ).toEqual([]);
  });
});
