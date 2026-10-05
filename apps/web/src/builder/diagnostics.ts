/**
 * Compiler diagnostics in the person's terms: where a problem is by node and field name instead of
 * a JSON pointer, and for the common blockers what to do next. The code and pointer stay on the
 * diagnostic for the technical line; nothing here changes what the compiler reported.
 */
import type { Diagnostic, WorkflowDefinition } from "@flowaid/workflow-core";
import { describePointer } from "./FixPreview";

export interface PresentedDiagnostic {
  /** "Generate text › system" */
  where?: string;
  /** The compiler's message without a leading pointer the location already names. */
  message: string;
  /** What to do next, when the code says. */
  hint?: string;
  /** Which kind of fix the builder can offer. */
  remedy?: "node" | "credential" | "integration" | "knowledge" | "cost-limit" | "time-limit";
}

const HINTS: Partial<
  Record<Diagnostic["code"], { hint: string; remedy: PresentedDiagnostic["remedy"] }>
> = {
  E_CREDENTIAL_SLOT_UNBOUND: {
    hint: "This step needs a key. Open the node and choose one under Credentials, or add one there.",
    remedy: "credential",
  },
  E_TOOL_UNRESOLVED: {
    hint: "Connect the server or API under Integrations, then choose it on the node.",
    remedy: "integration",
  },
  E_INPUT_REQUIRED_MISSING: {
    hint: "Connect an earlier step's output to this input, or type a value on the node.",
    remedy: "node",
  },
  W_COST_ESTIMATE: {
    hint: "Set a cost limit per run under Execution, so a run stops before it spends more.",
    remedy: "cost-limit",
  },
  W_HUMAN_EXPIRY_EXCEEDS_RUN_TIMEOUT: {
    hint: "Raise the run time limit under Execution above how long the step waits, or give the step a shorter expiry.",
    remedy: "time-limit",
  },
};

/** "Classify › config.model" reads as "Classify › model": config is where every setting lives. */
function where(d: Diagnostic, def: WorkflowDefinition): string | undefined {
  const path = d.location.path;
  if (path && /^\/(nodes|edges)\//.test(path))
    return describePointer(path, def)
      .replace(" › config.", " › ")
      .replace(/ › config$/, "");
  const nodeId = d.location.nodeId;
  if (nodeId) return def.nodes.find((n) => n.id === nodeId)?.name ?? nodeId;
  return undefined;
}

/** A template placeholder for a knowledge source is chosen on the node, from the Knowledge page. */
const KNOWLEDGE_PLACEHOLDER = {
  hint: "Open the node and choose a knowledge source under Documents. No sources yet? Add one on the Knowledge page first.",
  remedy: "knowledge" as const,
};

export function presentDiagnostic(d: Diagnostic, def: WorkflowDefinition): PresentedDiagnostic {
  const path = d.location.path;
  const message =
    path && d.message.startsWith(`${path}: `) ? d.message.slice(path.length + 2) : d.message;
  const known =
    d.code === "E_TOOL_UNRESOLVED" && d.message.includes("$template.knowledge.")
      ? KNOWLEDGE_PLACEHOLDER
      : HINTS[d.code];
  const loc = where(d, def);
  return {
    message,
    ...(loc ? { where: loc } : {}),
    ...(known
      ? { hint: known.hint, remedy: known.remedy }
      : d.location.nodeId
        ? { remedy: "node" as const }
        : {}),
  };
}

/** The node a diagnostic belongs to: its location, else the node its pointer is inside. */
export function diagnosticNodeId(d: Diagnostic, def: WorkflowDefinition): string | undefined {
  if (d.location.nodeId) return d.location.nodeId;
  const m = /^\/nodes\/(\d+)(\/|$)/.exec(d.location.path ?? "");
  return m ? def.nodes[Number(m[1])]?.id : undefined;
}
