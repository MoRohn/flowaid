/**
 * A draft run that fails names the step and shows it failed (roadmap B-07). The builder stopped
 * reading a run once its record said it ended, even when the events it had read ended earlier, so
 * the failed step kept showing Running and the result could not say which step failed or why.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { foldRunEvents } from "@flowaid/ui/lib";
import type { Run } from "~/api/types";
import { stubApi } from "~/knowledge/pageindex/testApi";
import { settleLiveRun, useLiveRun } from "./useLiveRun";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** A workflow-core event fixture, re-pointed at the Assert step of this run. */
function event(type: string, seq: number, patch: Record<string, unknown> = {}) {
  const file = join(
    import.meta.dirname,
    "../../../../packages/workflow-core/fixtures/events",
    `${type}.json`,
  );
  const base = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
  return {
    ...base,
    seq,
    ...("nodeId" in base ? { nodeId: "assert_1", nodeRunId: NR } : {}),
    ...patch,
  };
}

const RUN = "0192f0a1-5b3c-7d4e-8f60-1a2b3c4d5e6f";
const NR = "0192f0a1-5b3c-7d4e-8f60-0000000000f1";
const error = {
  code: "TIMEOUT_ERROR",
  message: "The message must be ok",
  retryable: false,
  runId: RUN,
  nodeId: "assert_1",
  nodeRunId: NR,
};
const started = event("RUN_STARTED", 1);
const scheduled = event("NODE_SCHEDULED", 2, { kind: "task", nodeType: "flowaid.dev.assert" });
const nodeStarted = event("NODE_STARTED", 3);
const nodeFailed = event("NODE_FAILED", 4, { error, attempt: 1 });
const runFailed = event("RUN_FAILED", 5, { error });

const failedRun = {
  id: RUN,
  status: "failed",
  error: { code: "TIMEOUT_ERROR", message: "The message must be ok", nodeId: "assert_1" },
  createdAt: "2026-10-05T10:00:00.000Z",
} as unknown as Run;

const lookup = {
  categoryFor: () => "data" as const,
  nameFor: (id: string) => (id === "assert_1" ? "Assert" : id),
};

describe("settleLiveRun", () => {
  it("fails the step the run's error names and stops the others", () => {
    const folded = foldRunEvents([started, scheduled, nodeStarted], { categoryFor: () => "data" });
    expect(folded.nodeRuns[0]?.status).toBe("running");
    const settled = settleLiveRun(folded, failedRun);
    expect(settled.status).toBe("failed");
    expect(settled.error).toMatchObject({ nodeId: "assert_1", message: "The message must be ok" });
    expect(settled.nodeRuns[0]?.status).toBe("failed");
  });

  it("leaves a run that has not ended as its events say", () => {
    const folded = foldRunEvents([started, scheduled, nodeStarted], { categoryFor: () => "data" });
    expect(settleLiveRun(folded, { ...failedRun, status: "running" })).toBe(folded);
  });
});

describe("useLiveRun", () => {
  it("keeps reading a run that ended until its end is folded, and shows the step failed", async () => {
    // the record already says failed while the events read so far end with the step running
    let reads = 0;
    stubApi({
      [`GET /v1/runs/${RUN}`]: () => failedRun,
      [`GET /v1/runs/${RUN}/events`]: () => {
        reads += 1;
        return {
          items:
            reads === 1
              ? [started, scheduled, nodeStarted]
              : reads === 2
                ? [nodeFailed, runFailed]
                : [],
          next_cursor: null,
        };
      },
    });
    const { result } = renderHook(() => useLiveRun(RUN, lookup));
    await waitFor(() => expect(result.current?.folded.nodeRuns[0]?.status).toBe("failed"));
    await waitFor(() => expect(reads).toBeGreaterThanOrEqual(2));
    expect(result.current?.folded.error?.message).toBe("The message must be ok");
    expect(result.current?.folded.nodeRuns[0]?.nodeName).toBe("Assert");
    const settled = reads;
    await new Promise((r) => setTimeout(r, 900));
    expect(reads).toBe(settled);
  });
});
