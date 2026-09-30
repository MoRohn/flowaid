import { describe, expect, it } from "vitest";
import type { WorkflowDiff } from "@flowaid/workflow-compiler";
import type { Diagnostic } from "@flowaid/workflow-core";
import { changeCount, publishChecks, publishOutcome } from "./publishReview";

const empty: WorkflowDiff = {
  nodes: { added: [], removed: [], changed: [] },
  edges: { added: [], removed: [] },
  inputs: [],
  outputs: [],
  variables: [],
  secrets: [],
  execution: [],
  document: [],
  layoutOnly: false,
};
const diag = (severity: "error" | "warning"): Diagnostic => ({
  code: "E_SCHEMA",
  severity,
  message: "m",
  location: { path: "/" },
});
const base = {
  diagnostics: [],
  latestVersion: 3,
  changes: { ...empty, nodes: { added: ["a"], removed: [], changed: [] } },
  comparing: false,
  deployTo: [],
  gate: null,
};
const state = (id: string, checks: ReturnType<typeof publishChecks>) =>
  checks.find((c) => c.id === id)?.state;

describe("publishChecks", () => {
  it("is ready with a clean, changed draft", () => {
    const checks = publishChecks(base);
    expect(checks.every((c) => c.state === "ok")).toBe(true);
    expect(checks.find((c) => c.id === "changes")?.label).toBe("1 change since v3");
  });

  it("blocks on compiler errors and only warns on warnings", () => {
    expect(state("compile", publishChecks({ ...base, diagnostics: [diag("error")] }))).toBe(
      "blocker",
    );
    expect(state("compile", publishChecks({ ...base, diagnostics: [diag("warning")] }))).toBe(
      "warning",
    );
  });

  it("blocks an identical version and allows a layout-only one", () => {
    expect(state("changes", publishChecks({ ...base, changes: empty }))).toBe("blocker");
    expect(
      state("changes", publishChecks({ ...base, changes: { ...empty, layoutOnly: true } })),
    ).toBe("info");
  });

  it("says the first publish is v1 and shows a pending comparison", () => {
    expect(publishChecks({ ...base, latestVersion: null, changes: null })[1]?.label).toMatch(/v1/);
    expect(state("changes", publishChecks({ ...base, comparing: true, changes: null }))).toBe(
      "checking",
    );
  });

  it("blocks deploying to an environment with unbound required secrets", () => {
    const checks = publishChecks({
      ...base,
      deployTo: [
        { name: "prod", missingSecrets: ["OPENAI_KEY"] },
        { name: "dev", missingSecrets: [] },
        { name: "staging", missingSecrets: undefined },
      ],
    });
    expect(state("secrets:prod", checks)).toBe("blocker");
    expect(state("secrets:dev", checks)).toBe("ok");
    expect(checks.some((c) => c.id === "secrets:staging")).toBe(false);
  });

  it("explains an evaluation gate without claiming it will pass", () => {
    const checks = publishChecks({ ...base, gate: { setName: "Refunds", minPassRate: 0.9 } });
    expect(checks.find((c) => c.id === "gate")).toMatchObject({ state: "info" });
    expect(checks.find((c) => c.id === "gate")?.label).toMatch(/Refunds of at least 90%/);
  });
});

describe("changeCount", () => {
  it("counts nodes, edges and changed sections", () => {
    expect(changeCount(empty)).toBe(0);
    expect(
      changeCount({
        ...empty,
        nodes: { added: ["a"], removed: ["b"], changed: [] },
        edges: { added: ["e"], removed: [] },
        inputs: [{ op: "add", path: "/x", value: 1 }],
      }),
    ).toBe(4);
  });
});

describe("publishOutcome", () => {
  it("names the next version and deploys nothing by default", () => {
    const lines = publishOutcome(3, []);
    expect(lines[1]).toMatch(/v4/);
    expect(lines[2]).toMatch(/Deploys nothing/);
    expect(lines).toContain("Starts no runs.");
  });

  it("names the environments it deploys to", () => {
    expect(publishOutcome(null, ["dev", "staging"])[2]).toMatch(/v1 to dev and staging/);
  });
});
