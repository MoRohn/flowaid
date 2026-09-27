import { describe, expect, it } from "vitest";
import {
  categoryFor,
  looksLikeExternalExport,
  toMigrationReport,
  type ApiImportReport,
} from "./report";

describe("external flow exports", () => {
  it("recognises canvas-graph exports, wrapped or not, and never a FlowAId definition", () => {
    const flow = { nodes: [{ id: "a", data: { name: "llmAgentflow" } }], edges: [] };
    expect(looksLikeExternalExport(flow)).toBe(true);
    expect(looksLikeExternalExport({ name: "x", flowData: JSON.stringify(flow) })).toBe(true);
    expect(
      looksLikeExternalExport({ ...flow, $schema: "https://flowaid.dev/schemas/workflow/v1" }),
    ).toBe(false);
    expect(looksLikeExternalExport({ nodes: [{ id: "start", kind: "input" }], edges: [] })).toBe(
      false,
    );
    expect(looksLikeExternalExport(null)).toBe(false);
  });

  it("maps the API report onto the dialog, with issue messages and categories", () => {
    const report: ApiImportReport = {
      format: "agentflow",
      workflowName: "Router",
      counts: { imported: 1, converted: 1, needsConfig: 0, unsupported: 0 },
      nodes: [
        {
          sourceId: "s",
          sourceType: "startAgentflow",
          name: "Start",
          nodeId: "start",
          targetType: "input",
          status: "imported",
        },
        {
          sourceId: "c",
          sourceType: "conditionAgentAgentflow",
          name: "Classify",
          nodeId: "c0",
          targetType: "flowaid.decision.router",
          status: "converted",
        },
      ],
      issues: [
        {
          code: "W_IMPORT_PROVIDER_CHANGED",
          severity: "warning",
          message: "now a TypeSafe decision",
          sourceId: "c",
        },
      ],
      secrets: [],
    };
    const view = toMigrationReport(report, "router.json");
    expect(view).toMatchObject({
      fileName: "router.json",
      workflowName: "Router",
      counts: report.counts,
    });
    expect(view.nodes[1]).toEqual({
      id: "c",
      sourceType: "conditionAgentAgentflow",
      name: "Classify",
      status: "converted",
      targetType: "flowaid.decision.router",
      category: "decision",
      message: "now a TypeSafe decision",
    });
    expect(categoryFor("@flowaid/nodes-langchain.retriever")).toBe("retrieval");
    expect(categoryFor("flowaid.tools.http")).toBe("tool");
  });
});
