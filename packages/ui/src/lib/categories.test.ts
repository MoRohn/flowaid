import { describe, expect, it } from "vitest";
import {
  NodeCategorySchema,
  NodeRunStatusSchema,
  RunOriginSchema,
  RunStatusSchema,
} from "@flowaid/workflow-core";
import {
  CATEGORY_LABEL,
  NODE_CATEGORIES,
  NODE_RUN_STATUSES,
  NODE_RUN_STATUS_LABEL,
  ORIGIN_LABEL,
  RUN_ORIGINS,
  RUN_STATUSES,
  STATUS_LABEL,
  TERMINAL_NODE_RUN_STATUSES,
  TERMINAL_RUN_STATUSES,
  isNodeCategory,
  isNodeRunStatus,
  isRunOrigin,
  isRunStatus,
} from "./categories";

describe("categories come from workflow-core", () => {
  it("re-exports the schema options verbatim", () => {
    expect(NODE_CATEGORIES).toEqual(NodeCategorySchema.options);
    expect(RUN_STATUSES).toEqual(RunStatusSchema.options);
    expect(NODE_RUN_STATUSES).toEqual(NodeRunStatusSchema.options);
    expect(RUN_ORIGINS).toEqual(RunOriginSchema.options);
  });

  it("labels every schema option exactly once", () => {
    expect(Object.keys(CATEGORY_LABEL).sort()).toEqual([...NodeCategorySchema.options].sort());
    expect(Object.keys(STATUS_LABEL).sort()).toEqual([...RunStatusSchema.options].sort());
    expect(Object.keys(NODE_RUN_STATUS_LABEL).sort()).toEqual(
      [...NodeRunStatusSchema.options].sort(),
    );
    expect(Object.keys(ORIGIN_LABEL).sort()).toEqual([...RunOriginSchema.options].sort());
    for (const label of [
      ...Object.values(CATEGORY_LABEL),
      ...Object.values(STATUS_LABEL),
      ...Object.values(NODE_RUN_STATUS_LABEL),
      ...Object.values(ORIGIN_LABEL),
    ]) {
      expect(label.trim().length).toBeGreaterThan(0);
    }
  });

  it("knows the terminal statuses", () => {
    expect([...TERMINAL_RUN_STATUSES].sort()).toEqual([
      "cancelled",
      "completed",
      "failed",
      "timed_out",
    ]);
    expect([...TERMINAL_NODE_RUN_STATUSES].sort()).toEqual([
      "cancelled",
      "completed",
      "failed",
      "reused",
      "skipped",
    ]);
    for (const s of TERMINAL_RUN_STATUSES) expect(RunStatusSchema.options).toContain(s);
    for (const s of TERMINAL_NODE_RUN_STATUSES) expect(NodeRunStatusSchema.options).toContain(s);
  });

  it("guards strings against the schema options", () => {
    expect(isRunStatus("waiting_for_human")).toBe(true);
    expect(isRunStatus("retrying")).toBe(true);
    expect(isNodeRunStatus("retrying")).toBe(false);
    expect(isNodeRunStatus("retry_wait")).toBe(true);
    expect(isNodeRunStatus("reused")).toBe(true);
    expect(isRunOrigin("manual")).toBe(false);
    expect(isRunOrigin("ui")).toBe(true);
    expect(isRunOrigin("fork")).toBe(true);
    expect(isNodeCategory("developer")).toBe(true);
    expect(isNodeCategory("misc")).toBe(false);
  });
});
