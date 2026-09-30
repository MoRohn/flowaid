import { describe, expect, it } from "vitest";
import type { Environment } from "~/api/types";
import {
  ANY_ENVIRONMENT,
  apiKeyBody,
  apiKeyChecks,
  emptyApiKeyDraft,
  expiringKeys,
  uncoveredEvents,
  type ApiKeyDraft,
} from "./guidance";

const envs = [
  { id: "env-dev", name: "dev", protected: false, variables: {} },
  { id: "env-prod", name: "prod", protected: true, variables: {} },
] as unknown as Environment[];
const draft = (over: Partial<ApiKeyDraft> = {}): ApiKeyDraft => ({
  ...emptyApiKeyDraft(["workflows:read", "runs:create", "runs:read"]),
  name: "website-form",
  ...over,
});
const ids = (d: ApiKeyDraft, isAdmin = true) =>
  apiKeyChecks(d, { environments: envs, isAdmin }).map((c) => `${c.state}:${c.id}`);

describe("apiKeyChecks", () => {
  it("blocks a key without a name or scopes", () => {
    expect(ids(draft({ name: " ", scopes: [] }))).toEqual(
      expect.arrayContaining(["blocker:name", "blocker:scopes"]),
    );
  });

  it("needs one of the offered expiries", () => {
    expect(ids(draft({ days: "" }))).toContain("blocker:expiry");
  });

  it("says an unpinned run key must name its environment and reaches every workflow", () => {
    expect(ids(draft())).toEqual(["ok:valid", "warning:env-any", "info:workflows-any"]);
  });

  it("is quiet about reach once pinned to an environment and workflows", () => {
    expect(ids(draft({ env: "env-prod", pinned: ["wf-1"] }))).toEqual(["ok:valid"]);
  });

  it("refuses a test key limited to a protected environment, as the API does", () => {
    expect(ids(draft({ mode: "test", env: "env-prod" }))).toContain("blocker:test-protected");
    expect(ids(draft({ mode: "test", env: "env-dev" }))).not.toContain("blocker:test-protected");
  });

  it("flags admin, changing scopes, long life and service accounts without admin", () => {
    const out = ids(
      draft({ scopes: ["admin", "workflows:publish"], days: "365", serviceAccount: true }),
      false,
    );
    expect(out).toEqual(
      expect.arrayContaining([
        "blocker:service-account",
        "warning:admin",
        "info:changes",
        "info:long",
      ]),
    );
  });
});

describe("apiKeyBody", () => {
  it("sends only what is set", () => {
    const now = Date.parse("2026-09-29T00:00:00.000Z");
    expect(apiKeyBody(draft({ env: ANY_ENVIRONMENT, days: "30" }), now)).toEqual({
      name: "website-form",
      scopes: ["workflows:read", "runs:create", "runs:read"],
      mode: "live",
      expiresAt: "2026-10-29T00:00:00.000Z",
    });
    expect(
      apiKeyBody(draft({ env: "env-dev", pinned: ["wf-1"], rate: 60, serviceAccount: true }), now),
    ).toMatchObject({
      environmentId: "env-dev",
      workflowIds: ["wf-1"],
      rateLimitPerMin: 60,
      serviceAccount: { name: "website-form" },
    });
  });
});

describe("expiringKeys", () => {
  it("lists live keys that expire within two weeks, or already have", () => {
    const now = Date.parse("2026-09-29T00:00:00.000Z");
    const keys = [
      { name: "soon", expiresAt: "2026-10-05T00:00:00.000Z", revokedAt: null },
      { name: "later", expiresAt: "2026-12-01T00:00:00.000Z", revokedAt: null },
      { name: "gone", expiresAt: "2026-09-01T00:00:00.000Z", revokedAt: null },
      { name: "revoked", expiresAt: "2026-10-01T00:00:00.000Z", revokedAt: "2026-09-02" },
    ];
    expect(expiringKeys(keys, now).map((k) => k.name)).toEqual(["soon", "gone"]);
  });
});

describe("uncoveredEvents", () => {
  it("finds the events no enabled channel receives", () => {
    expect(
      uncoveredEvents([
        { enabled: true, events: ["run.failed"] },
        { enabled: false, events: ["human_task.created"] },
      ]),
    ).toEqual(["human_task.created"]);
    expect(uncoveredEvents([])).toEqual(["human_task.created", "run.failed"]);
  });
});
