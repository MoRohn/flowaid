import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { describeDb } from "@flowaid/database/testing";
import { call, createTestApp, login, type Jar, type TestApp } from "./test/app.js";

const model = { provider: "openai", model: "gpt-test" };

describeDb("agent presets and workflows as tools (Postgres)", () => {
  let t: TestApp;
  let jar: Jar;
  beforeAll(async () => {
    t = await createTestApp();
    jar = await login(t.app);
  });
  afterAll(() => t.close());

  it("reports features.agents on", async () => {
    expect((await call(t.app, jar, "GET", "/v1/me")).json().features.agents).toBe(true);
  });

  it("creates, lists, updates and deletes presets; names are unique; config is validated", async () => {
    const created = await call(t.app, jar, "POST", "/v1/agents", {
      name: "Support agent",
      description: "Answers order questions",
      config: {
        model: { candidates: [model], strategy: "ordered" },
        system: "Be helpful.",
        tools: [{ name: "lookup", approval: "never" }, { name: "refund" }],
        maxSteps: 6,
      },
    });
    expect(created.statusCode).toBe(201);
    const id = created.json().id as string;
    expect(created.json().config.tools[1]).toEqual({ name: "refund", approval: "irreversible" });

    expect(
      (await call(t.app, jar, "POST", "/v1/agents", { name: "Support agent", config: { model } }))
        .statusCode,
    ).toBe(409);
    expect(
      (
        await call(t.app, jar, "POST", "/v1/agents", {
          name: "Bad",
          config: { model, maxSteps: 500 },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await call(t.app, jar, "POST", "/v1/agents", {
          name: "Typo",
          config: { model, sytem: "x" },
        })
      ).statusCode,
    ).toBe(400);

    const patched = await call(t.app, jar, "PATCH", `/v1/agents/${id}`, {
      description: "Answers order and refund questions",
    });
    expect(patched.json()).toMatchObject({ description: "Answers order and refund questions" });
    expect((await call(t.app, jar, "GET", "/v1/agents")).json()).toHaveLength(1);
    expect((await call(t.app, jar, "GET", `/v1/agents/${id}`)).json().name).toBe("Support agent");

    const audit = (await call(t.app, jar, "GET", "/v1/audit?action=agent.create")).json() as {
      items: unknown[];
    };
    expect(audit.items).toHaveLength(1);

    expect((await call(t.app, jar, "DELETE", `/v1/agents/${id}`)).statusCode).toBe(204);
    expect((await call(t.app, jar, "GET", `/v1/agents/${id}`)).statusCode).toBe(404);
  });

  it("registers a published workflow as a tool with its input schema", async () => {
    const w = (await call(t.app, jar, "POST", "/v1/workflows", { name: "Lookup" })).json();
    const unpublished = await call(t.app, jar, "POST", "/v1/tools/workflow", {
      workflowId: w.id,
      toolName: "lookup",
      description: "Look up an order",
    });
    expect(unpublished.statusCode).toBe(400);
    await call(t.app, jar, "POST", `/v1/workflows/${w.id as string}/publish`, {});
    const tool = await call(t.app, jar, "POST", "/v1/tools/workflow", {
      workflowId: w.id,
      toolName: "lookup",
      description: "Look up an order",
    });
    expect(tool.statusCode).toBe(201);
    expect(tool.json()).toMatchObject({
      kind: "workflow",
      definitions: [
        {
          name: "lookup",
          source: { kind: "workflow", workflowId: w.id },
          inputSchema: { type: "object" },
          approvalRequired: false,
        },
      ],
    });
    const catalog = (await call(t.app, jar, "GET", "/v1/tools/catalog")).json() as {
      name: string;
    }[];
    expect(catalog.map((c) => c.name)).toContain("lookup");
  });
});

describeDb("agents turned off (Postgres)", () => {
  let t: TestApp;
  let jar: Jar;
  beforeAll(async () => {
    t = await createTestApp({ featuresDisabled: ["agents"] });
    jar = await login(t.app);
  });
  afterAll(() => t.close());

  describe("with FLOWAID_FEATURES_DISABLED=agents", () => {
    it("hides the feature and its routes", async () => {
      expect((await call(t.app, jar, "GET", "/v1/me")).json().features.agents).toBe(false);
      expect((await call(t.app, jar, "GET", "/v1/agents")).statusCode).toBe(404);
    });
  });
});
