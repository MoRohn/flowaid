import { describe, expect, it } from "vitest";
import { publishedCheck, secretChecks } from "./readiness";

const envs = [
  { id: "dev", name: "dev" },
  { id: "prod", name: "prod" },
];
const opts = { ws: "acme", workflowId: "wf", loading: false };

describe("secretChecks", () => {
  it("is one ok line when nothing is required", () => {
    const checks = secretChecks([{ name: "OPTIONAL", required: false }], envs, () => ({}), opts);
    expect(checks).toMatchObject([{ id: "secrets", state: "ok" }]);
  });

  it("warns per environment with a required secret unbound", () => {
    const bound: Record<string, Record<string, string>> = { dev: { OPENAI_KEY: "c1" }, prod: {} };
    const checks = secretChecks(
      [{ name: "OPENAI_KEY", required: true }],
      envs,
      (id) => bound[id],
      opts,
    );
    expect(checks.map((c) => [c.id, c.state])).toEqual([
      ["secrets:dev", "ok"],
      ["secrets:prod", "warning"],
    ]);
    expect(checks[1]?.label).toBe("prod: OPENAI_KEY not bound");
  });

  it("counts a required secret the server has a key for as ready", () => {
    const checks = secretChecks(
      [{ name: "TS", required: true, credentialType: "typesafe.api_key" }],
      envs,
      () => ({}),
      { ...opts, served: new Set(["typesafe.api_key"]) },
    );
    expect(checks.map((c) => c.state)).toEqual(["ok", "ok"]);
  });

  it("shows unknown bindings as checking while they load, and leaves them out after", () => {
    const declared = [{ name: "OPENAI_KEY", required: true }];
    expect(
      secretChecks(declared, envs, () => undefined, { ...opts, loading: true }).map((c) => c.state),
    ).toEqual(["checking", "checking"]);
    expect(secretChecks(declared, envs, () => undefined, opts)).toEqual([]);
  });
});

describe("publishedCheck", () => {
  it("needs a published version, or two to compare", () => {
    expect(publishedCheck(undefined, "acme", "wf").state).toBe("checking");
    expect(publishedCheck(0, "acme", "wf").state).toBe("blocker");
    expect(publishedCheck(2, "acme", "wf")).toMatchObject({
      state: "ok",
      label: "2 published versions",
    });
    expect(publishedCheck(1, "acme", "wf", 2)).toMatchObject({
      state: "blocker",
      label: "2 published versions (1 so far)",
    });
  });
});
