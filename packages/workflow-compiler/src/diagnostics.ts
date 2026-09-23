/**
 * Diagnostic collection. Severity follows the code prefix (`E_` error, `W_` warning, `I_` info,
 * ARCHITECTURE.md §4.6), so a pass never has to choose it and can never choose it wrong.
 */
import type { Diagnostic, DiagnosticCode } from "@flowaid/workflow-core";

export type DiagnosticLocation = Diagnostic["location"];
export type DiagnosticExtras = Pick<Diagnostic, "related" | "fix">;

export function severityOf(code: DiagnosticCode): Diagnostic["severity"] {
  if (code.startsWith("E_")) return "error";
  if (code.startsWith("W_")) return "warning";
  return "info";
}

/** Collects diagnostics in emission order; passes emit in a deterministic order, so the list is too. */
export class Diagnostics {
  readonly list: Diagnostic[] = [];

  add(
    code: DiagnosticCode,
    message: string,
    location: DiagnosticLocation = {},
    extras: DiagnosticExtras = {},
  ): void {
    const diagnostic: Diagnostic = { code, severity: severityOf(code), message, location };
    if (extras.related && extras.related.length > 0) diagnostic.related = extras.related;
    if (extras.fix) diagnostic.fix = extras.fix;
    this.list.push(diagnostic);
  }

  get errorCount(): number {
    let n = 0;
    for (const d of this.list) if (d.severity === "error") n += 1;
    return n;
  }

  hasErrors(): boolean {
    return this.list.some((d) => d.severity === "error");
  }
}

/** JSON pointer of a node in the definition document. */
export const nodePath = (index: number, ...rest: (string | number)[]): string =>
  ["", "nodes", String(index), ...rest.map(String)].join("/");

/** JSON pointer of a control edge in the definition document. */
export const edgePath = (index: number, ...rest: (string | number)[]): string =>
  ["", "edges", String(index), ...rest.map(String)].join("/");
