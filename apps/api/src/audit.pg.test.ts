import type { FastifyInstance, FastifyRequest } from "fastify";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "vitest";
import { auditEvents, savedViews } from "@flowaid/database";
import { describeDb } from "@flowaid/database/testing";
import { uuidv7 } from "@flowaid/shared";
import { ConflictError, NotFoundError } from "@flowaid/workflow-core";
import type { ApiContext } from "./context.js";
import { buildServer } from "./server.js";
import { call, createTestApp, login, type Jar, type TestApp } from "./test/app.js";

/** Routes that commit, roll back or only read, then answer as told. */
function testRoutes(app: FastifyInstance, ctx: ApiContext): void {
  const route = (
    path: string,
    action: string,
    handler: (req: FastifyRequest) => Promise<unknown>,
  ) =>
    app.post(
      `/v1/audit-test/${path}`,
      {
        config: {
          auth: "session",
          audit: { action, resource: "saved_view" },
          cli: { noun: "audit-test", verb: path },
        },
      },
      handler,
    );
  const view = (req: FastifyRequest, name: string) => {
    const principal = req.principal;
    if (!principal?.workspaceId || !principal.userId) throw new Error("no workspace session");
    return {
      id: uuidv7(),
      workspaceId: principal.workspaceId,
      userId: principal.userId,
      scope: "runs" as const,
      name,
      filters: {},
    };
  };
  const insertView = (req: FastifyRequest, name: string) => {
    const row = view(req, name);
    return ctx.db.tenant(row.workspaceId, (tx) => tx.insert(savedViews).values(row));
  };

  route("commit-then-fail", "test.commit_then_fail", async (req) => {
    await insertView(req, "committed, then failed");
    throw new ConflictError("the change committed, then the request failed");
  });
  route("rollback", "test.rollback", async (req) => {
    const row = view(req, "rolled back");
    await ctx.db.tenant(row.workspaceId, async (tx) => {
      await tx.insert(savedViews).values(row);
      throw new ConflictError("rolled back inside the transaction");
    });
  });
  route("read-then-404", "test.read_then_404", async (req) => {
    await ctx.db.tenant(view(req, "-").workspaceId, (tx) => tx.select().from(savedViews));
    throw new NotFoundError("nothing changed");
  });
  route("two-commits", "test.two_commits", async (req) => {
    await insertView(req, "first of two");
    await insertView(req, "second of two");
    req.audit = { resourceId: "both" };
    return { ok: true };
  });
}

describeDb("audit rows in the change's transaction (Postgres)", () => {
  let t: TestApp;
  let jar: Jar;
  /** A second server over the same database whose response-time completion always fails. */
  let crashing: FastifyInstance;

  const rowsFor = (requestId: string) =>
    t.ctx.db.system((tx) =>
      tx.select().from(auditEvents).where(eq(auditEvents.requestId, requestId)),
    );
  const viewsNamed = (name: string) =>
    t.ctx.db.system((tx) => tx.select().from(savedViews).where(eq(savedViews.name, name)));

  beforeAll(async () => {
    t = await createTestApp({}, { routes: [testRoutes] });
    jar = await login(t.app);
    crashing = await buildServer(
      { ...t.ctx },
      {
        routes: [testRoutes],
        auditCompletion: () => Promise.reject(new Error("the process died after the commit")),
      },
    );
    await crashing.ready();
  });
  afterAll(async () => {
    await crashing?.close();
    await t?.close();
  });

  it("writes one completed row for a successful mutation", async () => {
    const res = await call(t.app, jar, "POST", "/v1/saved-views", {
      scope: "runs",
      name: "Audited",
      filters: {},
    });
    expect(res.statusCode).toBe(200);
    const rows = await rowsFor(res.headers["x-request-id"] as string);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      action: "saved_view.save",
      resourceType: "saved_view",
      resourceId: res.json().id,
      details: { scope: "runs", name: "Audited" },
    });
  });

  it("keeps the row when the process dies after the commit", async () => {
    const res = await call(crashing, jar, "POST", "/v1/saved-views", {
      scope: "runs",
      name: "Survives a crash",
      filters: {},
    });
    expect(res.statusCode).toBe(200);
    // the change committed…
    expect(await viewsNamed("Survives a crash")).toHaveLength(1);
    // …and so did its row, written in the same transaction (the completion never ran)
    const rows = await rowsFor(res.headers["x-request-id"] as string);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ action: "saved_view.save", actorType: "user" });
  });

  it("audits a change that committed before the request failed", async () => {
    const res = await call(t.app, jar, "POST", "/v1/audit-test/commit-then-fail");
    expect(res.statusCode).toBe(409);
    expect(await viewsNamed("committed, then failed")).toHaveLength(1);
    const rows = await rowsFor(res.headers["x-request-id"] as string);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ action: "test.commit_then_fail", details: { status: 409 } });
  });

  it("writes no row for a change that rolled back, or a request that only read", async () => {
    const rolledBack = await call(t.app, jar, "POST", "/v1/audit-test/rollback");
    expect(rolledBack.statusCode).toBe(409);
    expect(await viewsNamed("rolled back")).toHaveLength(0);
    expect(await rowsFor(rolledBack.headers["x-request-id"] as string)).toHaveLength(0);

    const read = await call(t.app, jar, "POST", "/v1/audit-test/read-then-404");
    expect(read.statusCode).toBe(404);
    expect(await rowsFor(read.headers["x-request-id"] as string)).toHaveLength(0);
  });

  it("writes one row per request however many transactions it commits", async () => {
    const res = await call(t.app, jar, "POST", "/v1/audit-test/two-commits");
    expect(res.statusCode).toBe(200);
    expect(await viewsNamed("second of two")).toHaveLength(1);
    const rows = await rowsFor(res.headers["x-request-id"] as string);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ action: "test.two_commits", resourceId: "both" });
  });
});
