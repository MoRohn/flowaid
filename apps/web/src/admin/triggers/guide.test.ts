import { describe, expect, it } from "vitest";
import {
  exampleInput,
  existingTriggers,
  inputFields,
  missingInputs,
  triggerNotes,
  triggerPageChecks,
  validTimezone,
  type TriggerContext,
} from "./guide";

const inputs = {
  type: "object",
  properties: {
    email: { type: "string", description: "Who asked" },
    count: { type: "integer" },
    kind: { type: "string", enum: ["refund", "order"] },
  },
  required: ["email"],
};

const ctx: TriggerContext = {
  workflowId: "wf-1",
  latestVersion: null,
  deployments: [],
  environments: [
    { id: "e1", name: "dev", protected: false },
    { id: "e2", name: "prod", protected: true },
  ],
  liveWebhooks: [
    { workflowId: "wf-2", path: "prod/orders" },
    { workflowId: "wf-1", path: "dev/orders" },
  ],
  inputs,
};

const hook = {
  type: "webhook" as const,
  path: "orders",
  signature: "hmac_sha256" as const,
  responseMode: "async" as const,
};

describe("trigger guidance", () => {
  it("reads the input schema and builds an editable example", () => {
    expect(inputFields(inputs)).toEqual([
      { name: "email", type: "string", required: true, description: "Who asked" },
      { name: "count", type: "integer", required: false },
      { name: "kind", type: "string", required: false },
    ]);
    expect(exampleInput(inputs)).toEqual({ email: "example email", count: 0, kind: "refund" });
    expect(missingInputs(inputs, {})).toEqual(["email"]);
    expect(missingInputs(inputs, { email: "a@b.c" })).toEqual([]);
    expect(inputFields(undefined)).toEqual([]);
  });

  it("checks time zones", () => {
    expect(validTimezone("Europe/Paris")).toBe(true);
    expect(validTimezone("UTC")).toBe(true);
    expect(validTimezone("Mars/Olympus")).toBe(false);
    expect(validTimezone(" ")).toBe(false);
  });

  it("warns about a path another workflow uses, only in that environment", () => {
    const notes = triggerNotes(hook, ctx);
    const taken = notes.find((n) => n.id === "path-taken");
    expect(taken?.message).toContain("in prod");
    expect(taken?.message).not.toContain("dev");
    expect(notes.find((n) => n.id === "secret")?.state).toBe("info");
    expect(notes.find((n) => n.id === "body")?.message).toContain("email");
  });

  it("explains unsigned and waiting webhooks", () => {
    const notes = triggerNotes(
      { ...hook, path: "fresh", signature: "none", responseMode: "sync" },
      ctx,
    );
    expect(notes.find((n) => n.id === "path-taken")).toBeUndefined();
    expect(notes.find((n) => n.id === "unsigned")?.message).toContain("prod is protected");
    expect(notes.find((n) => n.id === "sync")?.message).toContain("30 seconds");
  });

  it("blocks a bad time zone and flags a busy cadence and missing input", () => {
    const notes = triggerNotes(
      { type: "schedule", cron: "*/15 * * * *", timezone: "Nowhere/City", input: {} },
      ctx,
    );
    expect(notes.find((n) => n.id === "timezone")?.state).toBe("blocker");
    expect(notes.find((n) => n.id === "cadence")?.message).toContain("96 runs a day");
    expect(notes.find((n) => n.id === "input")?.state).toBe("warning");
  });

  it("says where the workflow is live and that the trigger waits for the next deployment", () => {
    const never = triggerNotes(hook, ctx).find((n) => n.id === "lifecycle");
    expect(never?.message).toContain("never been published");
    const idle = triggerNotes(hook, { ...ctx, latestVersion: 2 }).find((n) => n.id === "lifecycle");
    expect(idle?.message).toContain("Version 2 is published but not deployed");
    const live = triggerNotes(hook, {
      ...ctx,
      latestVersion: 3,
      deployments: [{ environment: "dev", version: 3 }],
    }).find((n) => n.id === "lifecycle");
    expect(live?.message).toContain("Live now in dev (v3)");
  });

  it("lists the draft's triggers of one kind", () => {
    const def = {
      triggers: [
        { type: "manual" },
        { type: "webhook", path: "orders" },
        { type: "schedule", cron: "0 9 * * *", timezone: "Europe/Paris" },
      ],
    };
    expect(existingTriggers(def, "webhook")).toEqual(["/orders"]);
    expect(existingTriggers(def, "schedule")).toEqual(["0 9 * * * Europe/Paris"]);
  });
});

describe("triggers page checks", () => {
  const all = () => true;

  it("asks for a workflow first, and says when none is published", () => {
    expect(triggerPageChecks("webhooks", { ws: "acme", workflows: [], can: all })[0]).toMatchObject(
      {
        state: "blocker",
        fix: { href: "/acme/workflows" },
      },
    );
    expect(
      triggerPageChecks("schedules", {
        ws: "acme",
        workflows: [{ latestVersion: null }],
        can: all,
      })[0]?.state,
    ).toBe("warning");
  });

  it("flags webhooks that refuse calls or accept anyone", () => {
    const checks = triggerPageChecks("webhooks", {
      ws: "acme",
      workflows: [{ latestVersion: 1 }],
      webhooks: [
        { enabled: true, signature: "hmac_sha256", secretBound: false },
        { enabled: true, signature: "none", secretBound: false },
      ],
      can: all,
    });
    expect(checks.find((c) => c.id === "secrets")?.label).toContain("1 webhook refuses");
    expect(checks.find((c) => c.id === "unsigned")?.state).toBe("warning");
  });

  it("reports failing schedules, disabled tools and what the role cannot do", () => {
    const none = (s: string) => s === "schedules:write";
    const schedules = triggerPageChecks("schedules", {
      ws: "acme",
      workflows: [{ latestVersion: 1 }],
      schedules: [{ enabled: true, lastError: "skipped" }],
      can: none,
    });
    expect(schedules.find((c) => c.id === "live")?.state).toBe("warning");
    expect(schedules.find((c) => c.id === "add")?.state).toBe("info");
    const mcp = triggerPageChecks("mcp", {
      ws: "acme",
      workflows: [{ latestVersion: 1 }],
      exposures: [{ enabled: false }],
      can: () => false,
    });
    expect(mcp.map((c) => c.id)).toEqual(["workflows", "live", "tokens", "add"]);
  });
});
