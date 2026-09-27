/**
 * The FlowAId importer as the web app sees it: recognising an external flow export (so it goes
 * to the importer rather than the definition import) and mapping the API's migration report onto
 * the `ImportDialog` view.
 */
import type { ImportMigrationReport, ImportNodeReport } from "@flowaid/ui/builder";
import type { NodeCategory } from "@flowaid/workflow-core";

/** The migration report `POST /v1/workflows/import/preview` returns. */
export interface ApiImportReport {
  format: "agentflow" | "chatflow";
  workflowName: string;
  counts: { imported: number; converted: number; needsConfig: number; unsupported: number };
  nodes: {
    sourceId: string;
    sourceType: string;
    name: string;
    nodeId?: string;
    targetType?: string;
    status: ImportNodeReport["status"];
    message?: string;
  }[];
  issues: {
    code: string;
    severity: "error" | "warning";
    message: string;
    nodeId?: string;
    sourceId?: string;
  }[];
  secrets: string[];
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** A canvas-graph export (`{ nodes, edges }`, or a record holding `flowData`), not a FlowAId definition. */
export function looksLikeExternalExport(value: unknown): boolean {
  let v = value;
  if (isRecord(v) && typeof v.flowData === "string") {
    try {
      v = JSON.parse(v.flowData) as unknown;
    } catch {
      return false;
    }
  }
  if (!isRecord(v) || "$schema" in v || !Array.isArray(v.nodes) || !Array.isArray(v.edges))
    return false;
  return v.nodes.some((n) => isRecord(n) && isRecord(n.data) && typeof n.data.name === "string");
}

/** Parses pasted or uploaded text; `null` when it is not JSON. */
export function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

export function categoryFor(targetType: string | undefined): NodeCategory | undefined {
  if (!targetType) return undefined;
  if (targetType.startsWith("flowaid.decision.")) return "decision";
  if (targetType.startsWith("flowaid.ai.") || targetType.endsWith(".chat")) return "generation";
  if (targetType.endsWith(".agent")) return "agent";
  if (/retriever|vector_store|document_loader|text_splitter/.test(targetType)) return "retrieval";
  if (targetType.startsWith("flowaid.tools.")) return "tool";
  if (targetType === "human") return "human";
  return "flow";
}

export function toMigrationReport(
  report: ApiImportReport,
  fileName: string,
): ImportMigrationReport {
  return {
    fileName,
    workflowName: report.workflowName,
    counts: report.counts,
    nodes: report.nodes.map((n) => {
      const issue = report.issues.find((i) => i.sourceId === n.sourceId);
      const message = n.message ?? issue?.message;
      const category = categoryFor(n.targetType);
      return {
        id: n.sourceId,
        sourceType: n.sourceType,
        name: n.name,
        status: n.status,
        ...(n.targetType ? { targetType: n.targetType } : {}),
        ...(category ? { category } : {}),
        ...(message ? { message } : {}),
      };
    }),
  };
}
