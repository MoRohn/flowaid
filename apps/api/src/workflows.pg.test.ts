import { afterAll, beforeAll, expect, it } from "vitest";
import { describeDb } from "@flowaid/database/testing";
import { call, createTestApp, login, type Jar, type TestApp } from "./test/app.js";

describeDb("workflows, versions and deployments (Postgres)", () => {
  let t: TestApp;
  let jar: Jar;
  let envs: Record<string, string>;
  beforeAll(async () => {
    t = await createTestApp();
    jar = await login(t.app);
    envs = Object.fromEntries(
      (await call(t.app, jar, "GET", "/v1/environments"))
        .json()
        .map((e: { id: string; name: string }) => [e.name, e.id]),
    );
  });
  afterAll(() => t.close());

  const blank = async (name: string) => {
    const res = await call(t.app, jar, "POST", "/v1/workflows", { name });
    expect(res.statusCode).toBe(201);
    return res.json();
  };

  it("serves the node catalog with an ETag", async () => {
    const res = await call(t.app, jar, "GET", "/v1/nodes");
    expect(res.statusCode).toBe(200);
    const ids = (res.json() as { id: string }[]).map((m) => m.id);
    expect(ids).toContain("flowaid.decision.batch");
    expect(ids.length).toBeGreaterThanOrEqual(36);
    const cached = await call(t.app, jar, "GET", "/v1/nodes", undefined, {
      "if-none-match": String(res.headers.etag),
    });
    expect(cached.statusCode).toBe(304);
    expect(
      (
        await call(t.app, jar, "GET", `/v1/nodes/${encodeURIComponent("flowaid.tools.http")}`)
      ).json(),
    ).toMatchObject({ id: "flowaid.tools.http" });
    expect(
      (await call(t.app, jar, "GET", "/v1/models?provider=openai")).json().length,
    ).toBeGreaterThan(0);
  });

  it("creates blank workflows with unique slugs and a compiling draft", async () => {
    const a = await blank("Order Router");
    const b = await blank("Order Router");
    expect([a.slug, b.slug]).toEqual(["order-router", "order-router-2"]);
    expect(a.errors).toBe(0);
    expect(a.draft.id).toBe(a.id);
    const list = (await call(t.app, jar, "GET", "/v1/workflows?limit=1")).json();
    expect(list.items).toHaveLength(1);
    expect(list.next_cursor).not.toBeNull();
    const next = (
      await call(t.app, jar, "GET", `/v1/workflows?limit=1&cursor=${list.next_cursor}`)
    ).json();
    expect(next.items[0]?.id).not.toBe(list.items[0]?.id);
    expect(
      (await call(t.app, jar, "GET", "/v1/workflows?q=router")).json().items.length,
    ).toBeGreaterThanOrEqual(2);
  });

  it("saves drafts with If-Match, stores diagnostics and answers 412 on stale revisions", async () => {
    const w = await blank("Draft Test");
    const draft = { ...w.draft, description: "changed" };
    const saved = await call(
      t.app,
      jar,
      "PUT",
      `/v1/workflows/${w.id}/draft`,
      { definition: draft },
      { "if-match": String(w.draftRevision) },
    );
    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toMatchObject({
      draftRevision: w.draftRevision + 1,
      diagnostics: expect.any(Array),
    });
    const stale = await call(
      t.app,
      jar,
      "PUT",
      `/v1/workflows/${w.id}/draft`,
      { definition: draft },
      { "if-match": String(w.draftRevision) },
    );
    expect(stale.statusCode).toBe(412);
    expect(stale.json().error.details).toMatchObject({ currentRevision: w.draftRevision + 1 });
    const broken = {
      ...draft,
      nodes: [
        { id: "start", kind: "input", name: "x" },
        {
          id: "x",
          kind: "task",
          name: "Unknown",
          type: "flowaid.nope.nope",
          typeVersion: "1.0.0",
          config: {},
        },
      ],
    };
    const withErrors = await call(
      t.app,
      jar,
      "PUT",
      `/v1/workflows/${w.id}/draft`,
      { definition: broken },
      { "if-match": String(w.draftRevision + 1) },
    );
    expect(withErrors.statusCode).toBe(200);
    expect(
      (withErrors.json().diagnostics as { severity: string }[]).some((d) => d.severity === "error"),
    ).toBe(true);
    const notAWorkflow = await call(
      t.app,
      jar,
      "PUT",
      `/v1/workflows/${w.id}/draft`,
      { definition: { hello: "world" } },
      { "if-match": String(w.draftRevision + 2) },
    );
    expect(notAWorkflow.statusCode).toBe(422);
    const validated = (await call(t.app, jar, "POST", `/v1/workflows/${w.id}/validate`, {})).json();
    expect(validated.ok).toBe(false);
  });

  it("publishes, refuses unchanged republishes and compile errors, lists and diffs versions", async () => {
    const w = await blank("Publisher");
    const v1 = await call(t.app, jar, "POST", `/v1/workflows/${w.id}/publish`, { notes: "first" });
    expect(v1.statusCode).toBe(201);
    expect(v1.json()).toMatchObject({
      version: 1,
      kind: "published",
      notes: "first",
      plan: expect.any(Object),
    });
    expect((await call(t.app, jar, "POST", `/v1/workflows/${w.id}/publish`, {})).statusCode).toBe(
      409,
    );
    const cur = (await call(t.app, jar, "GET", `/v1/workflows/${w.id}`)).json();
    await call(
      t.app,
      jar,
      "PUT",
      `/v1/workflows/${w.id}/draft`,
      { definition: { ...cur.draft, description: "v2" } },
      { "if-match": String(cur.draftRevision) },
    );
    const v2 = (await call(t.app, jar, "POST", `/v1/workflows/${w.id}/publish`, {})).json();
    expect(v2.version).toBe(2);
    const versions = (await call(t.app, jar, "GET", `/v1/workflows/${w.id}/versions`)).json();
    expect(versions.map((v: { version: number }) => v.version)).toEqual([2, 1]);
    const d = (
      await call(
        t.app,
        jar,
        "GET",
        `/v1/workflow-versions/${v2.id as string}/diff/${v1.json().id as string}`,
      )
    ).json();
    expect(d.document).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: "/description" })]),
    );
    const yaml = await call(
      t.app,
      jar,
      "GET",
      `/v1/workflow-versions/${v2.id as string}/export?format=yaml`,
    );
    expect(yaml.headers["content-type"]).toContain("yaml");
    expect(yaml.body).toContain("description: v2");
    const restored = await call(
      t.app,
      jar,
      "POST",
      `/v1/workflow-versions/${v1.json().id as string}/restore-draft`,
    );
    expect(restored.statusCode).toBe(200);
  });

  it("creates from a template; unbound tool sentinels block publish with diagnostics", async () => {
    const templates = (await call(t.app, jar, "GET", "/v1/templates")).json();
    expect(templates.map((x: { slug: string }) => x.slug).sort()).toEqual([
      "github-issue-triage",
      "github-issue-triage.retrieval",
      "research-agent",
      "support-triage",
    ]);
    const created = await call(t.app, jar, "POST", "/v1/workflows", {
      name: "My triage",
      templateId: "support-triage",
    });
    expect(created.statusCode).toBe(201);
    const id = created.json().id as string;
    const pub = await call(t.app, jar, "POST", `/v1/workflows/${id}/publish`, {});
    expect(pub.statusCode).toBe(422);
    expect(pub.json().error).toMatchObject({
      code: "WORKFLOW_VALIDATION_ERROR",
      details: {
        diagnostics: expect.arrayContaining([
          expect.objectContaining({ code: "E_TOOL_UNRESOLVED" }),
        ]),
      },
    });
  });

  it("deploys with trigger materialisation, protects prod, requires secret bindings, rolls back", async () => {
    const w = await blank("Hooked");
    const cur = (await call(t.app, jar, "GET", `/v1/workflows/${w.id}`)).json();
    const draft = {
      ...cur.draft,
      triggers: [
        { type: "webhook", path: "orders", signature: "none" },
        {
          type: "schedule",
          cron: "0 9 * * 1-5",
          timezone: "Europe/Berlin",
          input: { message: "daily" },
        },
        { type: "mcp", toolName: "route_order", description: "Routes an order" },
      ],
    };
    await call(
      t.app,
      jar,
      "PUT",
      `/v1/workflows/${w.id}/draft`,
      { definition: draft },
      { "if-match": String(cur.draftRevision) },
    );
    const v1 = (await call(t.app, jar, "POST", `/v1/workflows/${w.id}/publish`, {})).json();
    const dep = await call(t.app, jar, "PUT", `/v1/workflows/${w.id}/deployments/${envs.dev}`, {
      versionId: v1.id,
    });
    expect(dep.statusCode).toBe(200);
    expect(dep.json().triggers).toMatchObject({
      webhooks: [
        {
          path: "dev/orders",
          url: "http://localhost:3001/hooks/default/dev/orders",
          secretBound: true,
        },
      ],
      schedules: [
        { cron: "0 9 * * 1-5", timezone: "Europe/Berlin", nextRunAt: expect.any(String) },
      ],
      mcpExposures: [{ toolName: "route_order" }],
    });
    // Another workflow cannot take the same webhook path or tool name.
    const other = await blank("Hooked 2");
    const oc = (await call(t.app, jar, "GET", `/v1/workflows/${other.id}`)).json();
    await call(
      t.app,
      jar,
      "PUT",
      `/v1/workflows/${other.id}/draft`,
      {
        definition: {
          ...oc.draft,
          triggers: [{ type: "webhook", path: "orders", signature: "none" }],
        },
      },
      { "if-match": String(oc.draftRevision) },
    );
    const ov = (await call(t.app, jar, "POST", `/v1/workflows/${other.id}/publish`, {})).json();
    const clash = await call(
      t.app,
      jar,
      "PUT",
      `/v1/workflows/${other.id}/deployments/${envs.dev}`,
      { versionId: ov.id },
    );
    expect(clash.statusCode).toBe(422);
    expect(JSON.stringify(clash.json())).toContain("E_TRIGGER_CONFLICT");

    // Redeploying without the schedule disables its row.
    const c2 = (await call(t.app, jar, "GET", `/v1/workflows/${w.id}`)).json();
    await call(
      t.app,
      jar,
      "PUT",
      `/v1/workflows/${w.id}/draft`,
      { definition: { ...draft, triggers: [draft.triggers[0]] } },
      { "if-match": String(c2.draftRevision) },
    );
    const v2 = (await call(t.app, jar, "POST", `/v1/workflows/${w.id}/publish`, {})).json();
    const dep2 = (
      await call(t.app, jar, "PUT", `/v1/workflows/${w.id}/deployments/${envs.dev}`, {
        versionId: v2.id,
      })
    ).json();
    expect(dep2.triggers.disabled.map((d: { kind: string }) => d.kind).sort()).toEqual([
      "mcp",
      "schedule",
    ]);
    const rolled = await call(
      t.app,
      jar,
      "POST",
      `/v1/workflows/${w.id}/deployments/${envs.dev}/rollback`,
      {},
    );
    expect(rolled.json()).toMatchObject({
      versionId: v1.id,
      triggers: { schedules: [expect.any(Object)] },
    });
    const deployments = (await call(t.app, jar, "GET", `/v1/workflows/${w.id}/deployments`)).json();
    expect(deployments).toEqual([expect.objectContaining({ environment: "dev", version: 1 })]);
  });

  it("checks secret bindings on deploy and binding types", async () => {
    const w = await blank("Needs secret");
    const cur = (await call(t.app, jar, "GET", `/v1/workflows/${w.id}`)).json();
    await call(
      t.app,
      jar,
      "PUT",
      `/v1/workflows/${w.id}/draft`,
      {
        definition: {
          ...cur.draft,
          secrets: [{ name: "CRM_TOKEN", credentialType: "http.bearer" }],
        },
      },
      { "if-match": String(cur.draftRevision) },
    );
    const v = (await call(t.app, jar, "POST", `/v1/workflows/${w.id}/publish`, {})).json();
    const blocked = await call(
      t.app,
      jar,
      "PUT",
      `/v1/workflows/${w.id}/deployments/${envs.staging}`,
      { versionId: v.id },
    );
    expect(blocked.statusCode).toBe(422);
    expect(JSON.stringify(blocked.json())).toContain("E_SECRET_UNBOUND");
    const unknownSecret = await call(
      t.app,
      jar,
      "PUT",
      `/v1/workflows/${w.id}/secrets/${envs.staging}`,
      { OTHER: "00000000-0000-4000-8000-000000000000" },
    );
    expect(unknownSecret.statusCode).toBe(400);
    // A matching credential row (the credentials routes arrive with the credentials slice).
    const ws = (await call(t.app, jar, "GET", "/v1/me")).json().principal.workspaceId as string;
    const [cred] = await t.db
      .admin`insert into credentials (id, workspace_id, name, type, storage) values (gen_random_uuid(), ${ws}, 'crm', 'http.bearer', 'db') returning id`;
    const [wrong] = await t.db
      .admin`insert into credentials (id, workspace_id, name, type, storage) values (gen_random_uuid(), ${ws}, 'other', 'http.basic', 'db') returning id`;
    expect(
      (
        await call(t.app, jar, "PUT", `/v1/workflows/${w.id}/secrets/${envs.staging}`, {
          CRM_TOKEN: wrong?.id as string,
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await call(t.app, jar, "PUT", `/v1/workflows/${w.id}/secrets/${envs.staging}`, {
          CRM_TOKEN: cred?.id as string,
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (await call(t.app, jar, "GET", `/v1/workflows/${w.id}/secrets/${envs.staging}`)).json(),
    ).toEqual({ CRM_TOKEN: cred?.id });
    expect(
      (
        await call(t.app, jar, "PUT", `/v1/workflows/${w.id}/deployments/${envs.staging}`, {
          versionId: v.id,
        })
      ).statusCode,
    ).toBe(200);
    const used = (
      await call(t.app, jar, "GET", `/v1/secrets/where-used?credentialId=${cred?.id as string}`)
    ).json();
    expect(used).toEqual([
      { workflowId: w.id, environmentId: envs.staging, secretName: "CRM_TOKEN" },
    ]);
  });

  it("pinned API keys see only their workflows; import/export round-trips; clone and archive", async () => {
    const a = await blank("Pinned A");
    await blank("Pinned B");
    const key = (
      await call(t.app, jar, "POST", "/v1/api-keys", {
        name: "pinned",
        scopes: ["workflows:read", "workflows:write"],
        workflowIds: [a.id],
      })
    ).json().key as string;
    const headers = { authorization: `Bearer ${key}` };
    const list = (
      await t.app.inject({ method: "GET", url: "/v1/workflows?limit=200", headers })
    ).json();
    expect(list.items.map((x: { id: string }) => x.id)).toEqual([a.id]);
    const exported = await call(t.app, jar, "GET", `/v1/workflows/${a.id}/draft/export`);
    const imported = await call(t.app, jar, "POST", "/v1/workflows/import", {
      definition: JSON.parse(exported.body),
      name: "Imported A",
    });
    expect(imported.statusCode).toBe(201);
    expect(imported.json().workflow.id).not.toBe(a.id);
    const clone = await call(t.app, jar, "POST", `/v1/workflows/${a.id}/clone`, {});
    expect(clone.json().name).toBe("Pinned A (copy)");
    expect((await call(t.app, jar, "DELETE", `/v1/workflows/${a.id}`)).statusCode).toBe(204);
    const after = (await call(t.app, jar, "GET", "/v1/workflows?limit=200"))
      .json()
      .items.map((x: { id: string }) => x.id);
    expect(after).not.toContain(a.id);
    const audit = await t.db.admin`select action from audit_events where action like 'workflow.%'`;
    expect(new Set(audit.map((x) => x.action))).toEqual(
      new Set([
        "workflow.create",
        "workflow.draft_saved",
        "workflow.publish",
        "workflow.deploy",
        "workflow.rollback",
        "workflow.import",
        "workflow.clone",
        "workflow.delete",
        "workflow.draft_restored",
      ]),
    );
  });
});
