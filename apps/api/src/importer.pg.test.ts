import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { plugins } from "@flowaid/database";
import { describeDb } from "@flowaid/database/testing";
import { uuidv7 } from "@flowaid/shared";
import type { NodeManifest } from "@flowaid/workflow-core";
import { call, createTestApp, login, type Jar, type TestApp } from "./test/app.js";

const FIXTURES = join(import.meta.dirname, "..", "..", "..", "packages", "importer", "fixtures");
const fixture = (name: string): unknown => JSON.parse(readFileSync(join(FIXTURES, name), "utf8"));

describeDb("importing external flow exports (Postgres)", () => {
  let t: TestApp;
  let jar: Jar;
  beforeAll(async () => {
    t = await createTestApp();
    jar = await login(t.app);
    // the worker registers the bundled LangChain package; do the same here
    const langchain = (
      JSON.parse(
        readFileSync(join(FIXTURES, "..", "..", "nodes-langchain", "manifest.json"), "utf8"),
      ) as { nodes: NodeManifest[] }
    ).nodes;
    await t.db.app.system((tx) =>
      tx.insert(plugins).values({
        id: uuidv7(),
        workspaceId: null,
        packageName: "@flowaid/nodes-langchain",
        version: "0.1.0",
        source: "bundled",
        integrity: "0.1.0",
        manifests: langchain,
        status: "enabled",
      }),
    );
  });
  afterAll(async () => t.close());

  it("previews the migration report and diagnostics without saving anything", async () => {
    const before = (await call(t.app, jar, "GET", "/v1/workflows")).json().items.length as number;
    const res = await call(t.app, jar, "POST", "/v1/workflows/import/preview", {
      external: fixture("agentflow-support-router.json"),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().report).toMatchObject({
      format: "agentflow",
      workflowName: "Support router",
      counts: { imported: 7, converted: 1, needsConfig: 0, unsupported: 0 },
      secrets: expect.arrayContaining(["TYPESAFE_API_KEY", "OPENAI_API_KEY"]),
    });
    expect(
      (res.json().diagnostics as { severity: string }[]).filter((d) => d.severity === "error"),
    ).toEqual([]);
    expect((await call(t.app, jar, "GET", "/v1/workflows")).json().items.length).toBe(before);
  });

  it("imports an export as a workflow, keeping placeholders as compile errors", async () => {
    const res = await call(t.app, jar, "POST", "/v1/workflows/import", {
      external: fixture("chatflow-llm-chain.json"),
      name: "Translator",
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      workflow: { name: "Translator", errors: 1 },
      report: { format: "chatflow", counts: { unsupported: 1 } },
    });
    expect(
      (res.json().diagnostics as { code: string }[]).some((d) => d.code === "E_IMPORT_UNSUPPORTED"),
    ).toBe(true);
    const wf = (
      await call(t.app, jar, "GET", `/v1/workflows/${res.json().workflow.id as string}`)
    ).json();
    expect(
      wf.draft.nodes.some((n: { type?: string }) => n.type === "@flowaid/nodes-langchain.chat"),
    ).toBe(true);
    const audit = (await call(t.app, jar, "GET", "/v1/audit?action=workflow.import")).json();
    expect(audit.items[0].details).toMatchObject({ source: "external chatflow" });
  });

  it("answers 400 for a document that is not a flow export", async () => {
    const res = await call(t.app, jar, "POST", "/v1/workflows/import", { external: { hello: 1 } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toMatch(/flow export could not be read/);
  });
});
