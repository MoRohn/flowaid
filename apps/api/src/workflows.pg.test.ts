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

  it("puts the description given at creation in the draft too, which the builder shows", async () => {
    const res = await call(t.app, jar, "POST", "/v1/workflows", {
      name: "Described",
      description: "Routes refund requests",
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      description: "Routes refund requests",
      draft: { description: "Routes refund requests" },
    });
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
    expect(versions.items.map((v: { version: number }) => v.version)).toEqual([2, 1]);
    expect(versions.next_cursor).toBeNull();
    const newest = (
      await call(t.app, jar, "GET", `/v1/workflows/${w.id}/versions?limit=1`)
    ).json() as { items: { version: number }[]; next_cursor: string | null };
    expect(newest.items.map((v) => v.version)).toEqual([2]);
    const older = (
      await call(
        t.app,
        jar,
        "GET",
        `/v1/workflows/${w.id}/versions?limit=1&cursor=${newest.next_cursor ?? ""}`,
      )
    ).json();
    expect(older).toEqual({ items: [expect.objectContaining({ version: 1 })], next_cursor: null });
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
      "expense-approval",
      "github-issue-triage",
      "github-issue-triage.retrieval",
      "it-helpdesk-routing",
      "lead-qualification",
      "message-triage",
      "pageindex-agent",
      "pageindex-compare",
      "pageindex-document-qa",
      "refund-requests",
      "research-agent",
      "support-triage",
    ]);
    const created = await call(t.app, jar, "POST", "/v1/workflows", {
      name: "My triage",
      templateId: "support-triage",
    });
    expect(created.statusCode).toBe(201);
    const id = created.json().id as string;
    // the copy's record carries the template's description, as its definition does
    const copy = (await call(t.app, jar, "GET", `/v1/workflows/${id}`)).json();
    expect(copy.description).toMatch(/^Batch-judge a support ticket/);
    expect(copy.description).toBe(copy.draft.description);
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

  it("keeps a hand-made MCP exposure across deploys and rollbacks; it is live while a version is deployed", async () => {
    const w = await blank("Exposed by hand");
    const v1 = (await call(t.app, jar, "POST", `/v1/workflows/${w.id}/publish`, {})).json();
    const made = await call(t.app, jar, "POST", "/v1/mcp/exposures", {
      workflowId: w.id,
      environmentId: envs.dev,
      toolName: "by_hand",
      description: "Made in Triggers",
    });
    expect(made.statusCode).toBe(201);
    const exposureId = made.json().exposure.id as string;
    const key = (
      await call(t.app, jar, "POST", "/v1/mcp/tokens", {
        name: "client",
        workflowIds: [w.id],
        environmentId: envs.dev,
      })
    ).json().key as string;
    let n = 0;
    const listed = async () => {
      const res = await t.app.inject({
        method: "POST",
        url: "/mcp/default",
        headers: {
          authorization: `Bearer ${key}`,
          accept: "application/json, text/event-stream",
          "content-type": "application/json",
        },
        payload: { jsonrpc: "2.0", id: ++n, method: "tools/list", params: {} },
      });
      return (res.json().result.tools as { name: string }[]).map((x) => x.name);
    };
    const state = async () =>
      (
        (await call(t.app, jar, "GET", "/v1/mcp/exposures?limit=200")).json().items as {
          id: string;
        }[]
      ).find((e) => e.id === exposureId);

    // made before anything is deployed: on, but clients see nothing until a deploy
    expect(await state()).toMatchObject({ enabled: true, deployed: false, active: false });
    expect(await listed()).not.toContain("by_hand");

    const dep1 = (
      await call(t.app, jar, "PUT", `/v1/workflows/${w.id}/deployments/${envs.dev}`, {
        versionId: v1.id,
      })
    ).json();
    expect(dep1.triggers.disabled).toEqual([]);
    expect(await state()).toMatchObject({ enabled: true, deployed: true, active: true });
    expect(await listed()).toContain("by_hand");

    // a second version without an MCP trigger leaves it on
    const c2 = (await call(t.app, jar, "GET", `/v1/workflows/${w.id}`)).json();
    await call(
      t.app,
      jar,
      "PUT",
      `/v1/workflows/${w.id}/draft`,
      { definition: { ...c2.draft, description: "Second version" } },
      { "if-match": String(c2.draftRevision) },
    );
    const v2 = (await call(t.app, jar, "POST", `/v1/workflows/${w.id}/publish`, {})).json();
    expect(v2.id).not.toBe(v1.id);
    const dep2 = (
      await call(t.app, jar, "PUT", `/v1/workflows/${w.id}/deployments/${envs.dev}`, {
        versionId: v2.id,
      })
    ).json();
    expect(dep2.triggers.disabled).toEqual([]);
    expect(await state()).toMatchObject({
      enabled: true,
      active: true,
      source: "manual",
      description: "Made in Triggers",
    });

    // and so does rolling back
    const rolled = await call(
      t.app,
      jar,
      "POST",
      `/v1/workflows/${w.id}/deployments/${envs.dev}/rollback`,
      {},
    );
    expect(rolled.json()).toMatchObject({ versionId: v1.id, triggers: { disabled: [] } });
    expect(await state()).toMatchObject({ enabled: true, active: true });
    expect(await listed()).toContain("by_hand");

    // switched off by hand, a deploy does not switch it back on
    await call(t.app, jar, "PATCH", `/v1/mcp/exposures/${exposureId}`, { enabled: false });
    await call(t.app, jar, "PUT", `/v1/workflows/${w.id}/deployments/${envs.dev}`, {
      versionId: v2.id,
    });
    expect(await state()).toMatchObject({ enabled: false, deployed: true, active: false });
    expect(await listed()).not.toContain("by_hand");
    await call(t.app, jar, "PATCH", `/v1/mcp/exposures/${exposureId}`, { enabled: true });
    expect(await listed()).toContain("by_hand");
  });

  it("re-enables a trigger exposure a later version dropped; it then stays on as a manual one", async () => {
    const w = await blank("Trigger exposed");
    const cur = (await call(t.app, jar, "GET", `/v1/workflows/${w.id}`)).json();
    const withTrigger = {
      ...cur.draft,
      triggers: [{ type: "mcp", toolName: "declared_tool", description: "Declared" }],
    };
    await call(
      t.app,
      jar,
      "PUT",
      `/v1/workflows/${w.id}/draft`,
      { definition: withTrigger },
      { "if-match": String(cur.draftRevision) },
    );
    const v1 = (await call(t.app, jar, "POST", `/v1/workflows/${w.id}/publish`, {})).json();
    const dep1 = (
      await call(t.app, jar, "PUT", `/v1/workflows/${w.id}/deployments/${envs.dev}`, {
        versionId: v1.id,
      })
    ).json();
    const exposureId = dep1.triggers.mcpExposures[0].id as string;
    const c2 = (await call(t.app, jar, "GET", `/v1/workflows/${w.id}`)).json();
    await call(
      t.app,
      jar,
      "PUT",
      `/v1/workflows/${w.id}/draft`,
      { definition: { ...withTrigger, triggers: [] } },
      { "if-match": String(c2.draftRevision) },
    );
    const v2 = (await call(t.app, jar, "POST", `/v1/workflows/${w.id}/publish`, {})).json();
    const dep2 = (
      await call(t.app, jar, "PUT", `/v1/workflows/${w.id}/deployments/${envs.dev}`, {
        versionId: v2.id,
      })
    ).json();
    // the version's own exposure goes with its trigger, as before
    expect(dep2.triggers.disabled).toEqual([{ kind: "mcp", id: exposureId }]);
    const on = await call(t.app, jar, "PATCH", `/v1/mcp/exposures/${exposureId}`, {
      enabled: true,
    });
    expect(on.json()).toMatchObject({ enabled: true, source: "manual", active: true });
    const dep3 = (
      await call(t.app, jar, "PUT", `/v1/workflows/${w.id}/deployments/${envs.dev}`, {
        versionId: v2.id,
      })
    ).json();
    expect(dep3.triggers.disabled).toEqual([]);
    // a version declaring it again updates its description and keeps the owner's switch
    await call(t.app, jar, "PATCH", `/v1/mcp/exposures/${exposureId}`, { enabled: false });
    await call(t.app, jar, "PUT", `/v1/workflows/${w.id}/deployments/${envs.dev}`, {
      versionId: v1.id,
    });
    const after = (
      (await call(t.app, jar, "GET", "/v1/mcp/exposures?limit=200")).json().items as {
        id: string;
      }[]
    ).find((e) => e.id === exposureId);
    expect(after).toMatchObject({ enabled: false, source: "manual", description: "Declared" });
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

  it("counts a required secret the server has a key for as satisfied (deploy, publish, run)", async () => {
    const w = await blank("Server key");
    const cur = (await call(t.app, jar, "GET", `/v1/workflows/${w.id}`)).json();
    await call(
      t.app,
      jar,
      "PUT",
      `/v1/workflows/${w.id}/draft`,
      {
        definition: {
          ...cur.draft,
          secrets: [{ name: "TYPESAFE_API_KEY", credentialType: "typesafe.api_key" }],
        },
      },
      { "if-match": String(cur.draftRevision) },
    );
    const v = (await call(t.app, jar, "POST", `/v1/workflows/${w.id}/publish`, {})).json();
    const deployTo = (env: string) =>
      call(t.app, jar, "PUT", `/v1/workflows/${w.id}/deployments/${env}`, { versionId: v.id });
    const runIn = (env: string) =>
      call(t.app, jar, "POST", `/v1/workflows/${w.id}/run`, {
        input: { message: "hi" },
        versionId: v.id,
        environmentId: env,
      });
    const previous = t.ctx.env;
    try {
      // no server key: deploys, publish-and-deploy and runs refuse the unbound required secret
      const blocked = await deployTo(envs.staging as string);
      expect(blocked.statusCode).toBe(422);
      expect(JSON.stringify(blocked.json())).toContain("E_SECRET_UNBOUND");
      const blockedRun = await runIn(envs.staging as string);
      expect(blockedRun.statusCode).toBe(422);
      expect(JSON.stringify(blockedRun.json())).toContain("E_SECRET_UNBOUND");
      const draft = (await call(t.app, jar, "GET", `/v1/workflows/${w.id}`)).json();
      await call(
        t.app,
        jar,
        "PUT",
        `/v1/workflows/${w.id}/draft`,
        { definition: { ...draft.draft, description: "v2" } },
        { "if-match": String(draft.draftRevision) },
      );
      const publishBlocked = await call(t.app, jar, "POST", `/v1/workflows/${w.id}/publish`, {
        deployTo: [envs.staging],
      });
      expect(publishBlocked.statusCode).toBe(422);
      expect(JSON.stringify(publishBlocked.json())).toContain("E_SECRET_UNBOUND");

      // TYPESAFE_API_KEY on the server answers the secret everywhere
      t.ctx.env = { ...(previous ?? {}), flags: { hasTypeSafe: true } } as never;
      expect((await deployTo(envs.staging as string)).statusCode).toBe(200);
      expect((await runIn(envs.staging as string)).statusCode).toBe(202);
      const published = await call(t.app, jar, "POST", `/v1/workflows/${w.id}/publish`, {
        deployTo: [envs.staging],
      });
      expect(published.statusCode).toBe(201);
    } finally {
      t.ctx.env = previous as never;
    }
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
