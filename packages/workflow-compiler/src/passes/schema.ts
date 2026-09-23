/**
 * Pass 1 — schema. `WorkflowDefinitionSchema.safeParse`; every Zod issue becomes `E_SCHEMA` with
 * the JSON pointer of the offending value. Compilation stops here on failure.
 */
import { WorkflowDefinitionSchema, type WorkflowDefinition } from "@flowaid/workflow-core";
import { escapePointerToken } from "@flowaid/workflow-core";
import type { Diagnostics } from "../diagnostics.js";

const MAX_SCHEMA_ISSUES = 50;

export function pointerOf(path: readonly PropertyKey[]): string {
  return path.map((p) => "/" + escapePointerToken(String(p))).join("");
}

export function schemaPass(input: unknown, diagnostics: Diagnostics): WorkflowDefinition | null {
  const parsed = WorkflowDefinitionSchema.safeParse(input);
  if (parsed.success) return parsed.data;
  const issues = parsed.error.issues;
  for (const issue of issues.slice(0, MAX_SCHEMA_ISSUES)) {
    const path = pointerOf(issue.path);
    diagnostics.add("E_SCHEMA", `${path || "(document)"}: ${issue.message}`, { path });
  }
  if (issues.length > MAX_SCHEMA_ISSUES) {
    diagnostics.add(
      "E_SCHEMA",
      `${issues.length - MAX_SCHEMA_ISSUES} more schema issues not shown`,
      {},
    );
  }
  return null;
}
