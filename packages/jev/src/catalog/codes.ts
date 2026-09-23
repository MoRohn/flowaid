/**
 * Jev diagnostic codes (JEV_ENGINEERING.md §13.2, RFC-0014): 45 additions to
 * `DiagnosticCodeSchema`. Until RFC-0014 is accepted, lint functions return
 * {@link JevDiagnostic} (= workflow-core `Diagnostic` with a Jev code); after J-08
 * `JevDiagnostic` is exactly `Diagnostic`. Severity follows the prefix (`E_`/`W_`/`I_`).
 */
import { z } from "zod";
import { DiagnosticSchema, type Diagnostic } from "@flowaid/workflow-core";

export const JEV_DIAGNOSTIC_CODES = [
  "E_JEV_CONTRACT_UNRESOLVED",
  "E_JEV_CONTRACT_INVALID",
  "E_JEV_INTERFACE_MISMATCH",
  "E_JEV_ESCALATION_UNWIRED",
  "W_JEV_IMPLICIT_CONTRACT",
  "W_JEV_CONTRACT_UNREVIEWED",
  "W_JEV_NO_ESCAPE_HATCH",
  "E_JEV_DYNAMIC_MENU_NO_ESCAPE",
  "E_JEV_MENU_LIMIT",
  "W_JEV_OPTIONS_UNDISTINGUISHED",
  "W_JEV_NO_STOP",
  "W_JEV_RUBRIC_LEVELS",
  "W_JEV_RUBRIC_ANCHORS",
  "W_JEV_INSTRUCTIONS_WEAK",
  "W_JEV_PRIMITIVE_MISMATCH",
  "W_JEV_SCORE_AS_MEASURE",
  "W_JEV_EXACT_RULE",
  "W_JEV_FREE_VALUE",
  "W_JEV_TRANSCRIPT_STATE",
  "W_JEV_CONCLUSION_AS_EVIDENCE",
  "I_JEV_INHERITED_JUDGMENT",
  "E_JEV_PACKET_BUDGET",
  "W_JEV_PACKET_LARGE",
  "E_JEV_PACKET_DATA_CLASS",
  "W_JEV_PACKET_UNDECLARED_FIELD",
  "W_JEV_EVIDENCE_UNVERSIONED",
  "E_JEV_THRESHOLDS_UNMAPPED",
  "W_JEV_THRESHOLDS_ILLUSTRATIVE",
  "W_JEV_SINGLE_THRESHOLD",
  "E_JEV_IRREVERSIBLE_AUTO",
  "E_JEV_AUTHORITY_EXCEEDED",
  "W_JEV_POLICY_IN_CLASSIFIER",
  "W_JEV_CONFIDENCE_UNUSED",
  "W_JEV_IMPROVE_UNWIRED",
  "E_JEV_BLIND_RETRY",
  "W_JEV_UNCALIBRATED_AUTO",
  "W_JEV_CONSENSUS_REASSURANCE",
  "I_JEV_BUNDLE",
  "E_JEV_BUNDLE_CLASS_MIX",
  "W_JEV_PARALLEL_SIDE_EFFECTS",
  "W_JEV_GENERATION_FOR_DECISION",
  "W_JEV_TRANSPORT_VERIFICATION",
  "W_JEV_UNGATED_TOOL",
  "W_JEV_PLACEMENT",
  "E_JEV_SHADOW_LEAK",
] as const;

export const JevDiagnosticCodeSchema = z.enum(JEV_DIAGNOSTIC_CODES);
export type JevDiagnosticCode = z.infer<typeof JevDiagnosticCodeSchema>;

/** Heuristic lints (◊ in §13.2): warnings only, suppressible per contract with a reason. */
export const HEURISTIC_CODES: ReadonlySet<JevDiagnosticCode> = new Set<JevDiagnosticCode>([
  "W_JEV_OPTIONS_UNDISTINGUISHED",
  "W_JEV_RUBRIC_ANCHORS",
  "W_JEV_INSTRUCTIONS_WEAK",
  "W_JEV_PRIMITIVE_MISMATCH",
  "W_JEV_EXACT_RULE",
  "W_JEV_FREE_VALUE",
  "W_JEV_CONCLUSION_AS_EVIDENCE",
  "W_JEV_POLICY_IN_CLASSIFIER",
]);

/** `Diagnostic` with a Jev code (RFC-0014 pending). */
export const JevDiagnosticSchema = DiagnosticSchema.extend({ code: JevDiagnosticCodeSchema });
export type JevDiagnostic = z.infer<typeof JevDiagnosticSchema>;

/** Severity implied by a code's prefix. */
export function severityOf(code: JevDiagnosticCode): JevDiagnostic["severity"] {
  if (code.startsWith("E_")) return "error";
  if (code.startsWith("W_")) return "warning";
  return "info";
}

/** Builds a Jev diagnostic with the severity of its prefix. */
export function jevDiagnostic(
  code: JevDiagnosticCode,
  message: string,
  location: Diagnostic["location"] = {},
  extra: Pick<Diagnostic, "related" | "fix"> = {},
): JevDiagnostic {
  return { code, severity: severityOf(code), message, location, ...extra };
}

/** True when a code is one of the §13.2 Jev codes. */
export function isJevDiagnosticCode(code: string): code is JevDiagnosticCode {
  return JevDiagnosticCodeSchema.safeParse(code).success;
}
