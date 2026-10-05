/**
 * W_HUMAN_EXPIRY_EXCEEDS_RUN_TIMEOUT (RFC-0023): the run's time limit counts the time spent
 * waiting for a person, so a human step that may stay open longer than the run is cancelled with
 * it while its card still promises the full expiry. Every shipped template stays inside its limit.
 */
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { compile } from "./index.js";
import { formatMs } from "./passes/structure.js";
import { instantiate } from "./test/demos.js";
import { CORE_FIXTURES, fixtureCatalog, readJson } from "./test/support.js";

type Doc = Record<string, any>;
const CODE = "W_HUMAN_EXPIRY_EXCEEDS_RUN_TIMEOUT";

const base = (): Doc => readJson("example-support-reply.json") as Doc;
const approve = (d: Doc): Doc => (d.nodes as Doc[]).find((n) => n.id === "approve") as Doc;
const warnings = (d: Doc) =>
  compile(d, { catalog: fixtureCatalog() }).diagnostics.filter((x) => x.code === CODE);

describe("a human step and the run's time limit", () => {
  it("warns when the step may wait longer than the run may last", () => {
    const d = base();
    d.execution.timeoutMs = 180_000;
    approve(d).expiresInMs = 7_200_000;
    const [w, ...more] = warnings(d);
    expect(more).toEqual([]);
    expect(w?.severity).toBe("warning");
    expect(w?.location).toEqual({ nodeId: "approve", path: expect.stringMatching(/expiresInMs$/) });
    expect(w?.message).toContain("waits up to 2 h for a person, but the run stops after 3 min");
  });

  it("warns when the step has no expiry at all", () => {
    const d = base();
    delete approve(d).expiresInMs;
    d.execution.timeoutMs = 900_000;
    approve(d).onExpire = "fail";
    delete approve(d).escalation;
    expect(warnings(d).map((w) => w.message)).toEqual([
      expect.stringContaining("waits for a person with no expiry, but the run stops after 15 min"),
    ]);
  });

  it("is quiet when the run outlasts the step", () => {
    const d = base();
    d.execution.timeoutMs = 2 * 86_400_000;
    approve(d).expiresInMs = 86_400_000;
    expect(warnings(d)).toEqual([]);
  });

  it("is quiet for every template that ships with a human step", () => {
    const files = [
      ...readdirSync(CORE_FIXTURES)
        .filter((f) => f.endsWith(".json"))
        .map((f) => [f]),
      ...readdirSync(join(CORE_FIXTURES, "variants"))
        .filter((f) => f.endsWith(".json"))
        .map((f) => ["variants", f]),
    ].filter(([first]) => first !== "example-support-reply.json");
    const withHumans = files.filter((parts) =>
      ((readJson(...parts) as Doc).nodes as Doc[]).some((n) => n.kind === "human"),
    );
    expect(withHumans.length).toBeGreaterThanOrEqual(3);
    for (const parts of withHumans) {
      const d = instantiate(readJson(...parts)) as Doc;
      expect(warnings(d), parts.join("/")).toEqual([]);
    }
  });
});

describe("formatMs", () => {
  it("reads in the largest whole unit", () => {
    expect(formatMs(45_000)).toBe("45 s");
    expect(formatMs(180_000)).toBe("3 min");
    expect(formatMs(7_200_000)).toBe("2 h");
    expect(formatMs(5_400_000)).toBe("1.5 h");
    expect(formatMs(86_400_000)).toBe("1 day");
    expect(formatMs(259_200_000)).toBe("3 days");
    expect(formatMs(500)).toBe("500 ms");
  });
});
