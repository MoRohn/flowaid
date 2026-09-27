/**
 * Suggestions as diagnostics (RFC-0020): the builder's Problems panel lists them with the other
 * findings, and a suggestion with a fix gets a quick-fix button.
 */
import type { Diagnostic } from "@flowaid/workflow-core";
import type { Suggestion } from "./types.js";

export function formatUsd(n: number): string {
  if (n === 0) return "$0";
  if (n < 0.01) return `$${n.toPrecision(2)}`;
  return `$${n.toFixed(2)}`;
}

/** One `I_COST_SUGGESTION` per suggestion, located at its first node. */
export function suggestionDiagnostics(suggestions: readonly Suggestion[]): Diagnostic[] {
  return suggestions.map((s) => {
    const saving =
      s.estimatedSavingsUsdPerRun > 0
        ? ` Saves about ${formatUsd(s.estimatedSavingsUsdPerRun)} per run (${s.risk} risk).`
        : ` Caps the worst case (${s.risk} risk).`;
    return {
      code: "I_COST_SUGGESTION",
      severity: "info",
      message: `${s.title}.${saving}`,
      location: s.nodeIds[0] ? { nodeId: s.nodeIds[0] } : {},
      ...(s.fix.length > 0 ? { fix: { title: s.title, patch: s.fix } } : {}),
    } satisfies Diagnostic;
  });
}
