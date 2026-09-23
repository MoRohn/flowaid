import { describe, expect, it } from "vitest";
import { deriveCanvasRunState, deriveEdgeState, latestNodeRuns } from "./deriveCanvasRunState";
import { SAMPLE_EDGES, SAMPLE_NODES, SAMPLE_RUN_STEPS, buildSampleRun } from "./sampleWorkflow";

describe("deriveCanvasRunState", () => {
  it("marks everything idle without a run", () => {
    const s = deriveCanvasRunState(SAMPLE_NODES, SAMPLE_EDGES, undefined);
    expect(Object.keys(s.nodes)).toHaveLength(0);
    expect(new Set(Object.values(s.edges))).toEqual(new Set(["idle"]));
  });

  it("marks the edges into the running node active and the rest idle at step 1", () => {
    const s = deriveCanvasRunState(SAMPLE_NODES, SAMPLE_EDGES, buildSampleRun(1));
    expect(s.nodes.start?.status).toBe("completed");
    expect(s.nodes.intent?.status).toBe("running");
    expect(s.edges["c-start-intent"]).toBe("active");
    expect(s.edges["d-start-intent"]).toBe("active");
    expect(s.edges["c-start-urgency"]).toBe("taken");
    expect(s.edges["d-start-urgency"]).toBe("taken");
    expect(s.edges["c-intent-router"]).toBe("idle");
    expect(s.edges["c-router-security"]).toBe("idle");
  });

  it("fires the router's taken control-out and prunes the others", () => {
    const s = deriveCanvasRunState(SAMPLE_NODES, SAMPLE_EDGES, buildSampleRun(6));
    expect(s.nodes.router?.routeTaken).toBe("security");
    expect(s.edges["c-router-security"]).toBe("taken");
    expect(s.edges["c-router-billing"]).toBe("not-taken");
    expect(s.edges["c-router-account"]).toBe("not-taken");
    expect(s.edges["c-router-other"]).toBe("not-taken");
    expect(s.edges["c-incident-draft"]).toBe("active");
    expect(s.edges["d-incident-draft"]).toBe("active");
    expect(s.edges["c-account-draft"]).toBe("idle");
    expect(s.edges["d-account-draft"]).toBe("idle");
  });

  it("routes the gate to the waiting human node at the end", () => {
    const s = deriveCanvasRunState(
      SAMPLE_NODES,
      SAMPLE_EDGES,
      buildSampleRun(SAMPLE_RUN_STEPS.length),
    );
    expect(s.nodes.gate?.routeTaken).toBe("review");
    expect(s.nodes.approve?.status).toBe("waiting");
    expect(s.edges["c-gate-review"]).toBe("taken");
    expect(s.edges["c-gate-pass"]).toBe("not-taken");
    expect(s.edges["c-gate-fail"]).toBe("not-taken");
    expect(s.edges["c-approve-send"]).toBe("idle");
    expect(s.edges["c-review-send"]).toBe("idle");
    expect(s.edges["d-draft-approve"]).toBe("taken");
  });

  it("exposes the decision on the node state", () => {
    const s = deriveCanvasRunState(SAMPLE_NODES, SAMPLE_EDGES, buildSampleRun(3));
    expect(s.nodes.intent?.decision?.value).toBe("security");
    expect(s.nodes.intent?.decision?.confidence).toBeCloseTo(0.81);
    expect(s.nodes.urgency?.durationMs).toBe(91);
  });
});

describe("deriveEdgeState", () => {
  const edge = { id: "e", source: "a", target: "b" };
  it("flags an error when the target failed after receiving data", () => {
    expect(deriveEdgeState(edge, { status: "completed" }, { status: "failed" })).toBe("error");
  });
  it("is not-taken when the source failed, was skipped or cancelled", () => {
    expect(deriveEdgeState(edge, { status: "failed" }, undefined)).toBe("not-taken");
    expect(deriveEdgeState(edge, { status: "skipped" }, undefined)).toBe("not-taken");
    expect(deriveEdgeState(edge, { status: "cancelled" }, undefined)).toBe("not-taken");
  });
  it("is not-taken when the target was skipped", () => {
    expect(deriveEdgeState(edge, { status: "completed" }, { status: "skipped" })).toBe("not-taken");
  });
  it("is idle while the source is still running or waiting", () => {
    expect(deriveEdgeState(edge, { status: "running" }, undefined)).toBe("idle");
    expect(deriveEdgeState(edge, { status: "waiting" }, undefined)).toBe("idle");
    expect(deriveEdgeState(edge, { status: "retry_wait" }, undefined)).toBe("idle");
  });
  it("is taken into a waiting target, active while it backs off, reused when it reused a cached result", () => {
    expect(deriveEdgeState(edge, { status: "completed" }, { status: "waiting" })).toBe("taken");
    expect(deriveEdgeState(edge, { status: "completed" }, { status: "retry_wait" })).toBe("active");
    expect(deriveEdgeState(edge, { status: "reused" }, { status: "reused" })).toBe("reused");
    expect(deriveEdgeState(edge, { status: "reused" }, undefined)).toBe("taken");
    expect(deriveEdgeState(edge, undefined, undefined)).toBe("idle");
  });
  it("fires `done` when a completed source reports no route and prunes its other control-outs", () => {
    const done = { ...edge, sourceHandle: "ctl:done" };
    const other = { ...edge, sourceHandle: "ctl:x" };
    expect(deriveEdgeState(done, { status: "completed" }, undefined)).toBe("taken");
    expect(deriveEdgeState(other, { status: "completed" }, undefined)).toBe("not-taken");
    expect(
      deriveEdgeState({ ...edge, route: "x" }, { status: "completed", routeTaken: "x" }, undefined),
    ).toBe("taken");
    expect(deriveEdgeState({ ...edge, kind: "control" }, { status: "completed" }, undefined)).toBe(
      "taken",
    );
  });
  it("fires `failed` when the source failed (routed error) and prunes the rest", () => {
    expect(
      deriveEdgeState(
        { ...edge, sourceHandle: "ctl:failed" },
        { status: "failed" },
        { status: "running" },
      ),
    ).toBe("active");
    expect(
      deriveEdgeState({ ...edge, sourceHandle: "ctl:done" }, { status: "failed" }, undefined),
    ).toBe("not-taken");
    expect(
      deriveEdgeState({ ...edge, sourceHandle: "out:value" }, { status: "failed" }, undefined),
    ).toBe("not-taken");
  });
  it("ignores routes on data edges", () => {
    expect(
      deriveEdgeState(
        { ...edge, sourceHandle: "out:value" },
        { status: "completed", routeTaken: "other" },
        undefined,
      ),
    ).toBe("taken");
  });
});

describe("latestNodeRuns", () => {
  it("keeps the highest attempt per node", () => {
    const run = buildSampleRun(2);
    const first = run.nodeRuns[0];
    if (!first) throw new Error("no runs");
    const retried = { ...first, id: "nr_retry", attempt: 2, status: "failed" as const };
    const latest = latestNodeRuns([...run.nodeRuns, retried]);
    expect(latest.get(first.nodeId)?.attempt).toBe(2);
    expect(latest.get(first.nodeId)?.status).toBe("failed");
  });
});
