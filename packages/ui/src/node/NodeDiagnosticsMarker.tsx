import { forwardRef, type ButtonHTMLAttributes } from "react";
import { CircleAlert, Info, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/cn";
import { Tooltip } from "@/primitives";
import type { Diagnostic, DiagnosticSeverity } from "@/types";

export interface NodeDiagnosticsMarkerProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  diagnostics: Diagnostic[];
}

/** Highest severity present, or undefined for an empty list. */
export function worstSeverity(diagnostics: Diagnostic[]): DiagnosticSeverity | undefined {
  if (diagnostics.some((d) => d.severity === "error")) return "error";
  if (diagnostics.some((d) => d.severity === "warning")) return "warning";
  return diagnostics.length ? "info" : undefined;
}

/** "2 errors, 1 warning" style summary used for the accessible name. */
export function diagnosticsSummary(diagnostics: Diagnostic[]): string {
  const count = (s: DiagnosticSeverity) => diagnostics.filter((d) => d.severity === s).length;
  const parts: string[] = [];
  const e = count("error");
  const w = count("warning");
  const i = count("info");
  if (e) parts.push(`${e} ${e === 1 ? "error" : "errors"}`);
  if (w) parts.push(`${w} ${w === 1 ? "warning" : "warnings"}`);
  if (i) parts.push(`${i} ${i === 1 ? "note" : "notes"}`);
  return parts.join(", ");
}

const SEVERITY_CLASS: Record<DiagnosticSeverity, string> = {
  error: "text-danger-text",
  warning: "text-warn-text",
  info: "text-info-text",
};

/**
 * Small compiler-diagnostic marker for a node header: red for errors, amber
 * for warnings. Hover or focus lists every message.
 */
export const NodeDiagnosticsMarker = forwardRef<HTMLButtonElement, NodeDiagnosticsMarkerProps>(
  function NodeDiagnosticsMarker({ diagnostics, className, ...rest }, ref) {
    const severity = worstSeverity(diagnostics);
    if (!severity) return null;
    const Icon = severity === "error" ? CircleAlert : severity === "warning" ? TriangleAlert : Info;
    const summary = diagnosticsSummary(diagnostics);
    return (
      <Tooltip
        side="top"
        align="end"
        content={
          <ul className="flex max-w-64 flex-col gap-1 py-0.5">
            {diagnostics.map((d, i) => (
              <li key={`${d.code}-${i}`} className="flex items-start gap-1.5 font-normal">
                <span
                  aria-hidden="true"
                  className={cn(
                    "mt-[5px] size-1.5 shrink-0 rounded-full",
                    d.severity === "error"
                      ? "bg-danger"
                      : d.severity === "warning"
                        ? "bg-warn"
                        : "bg-info",
                  )}
                />
                <span className="min-w-0">
                  <span className="font-mono text-2xs text-surface/60">{d.code}</span> {d.message}
                </span>
              </li>
            ))}
          </ul>
        }
      >
        {/* A real button so the tooltip (the diagnostics list) is keyboard-reachable. */}
        <button
          ref={ref}
          type="button"
          aria-label={summary}
          data-severity={severity}
          className={cn(
            "nodrag inline-flex size-4 shrink-0 cursor-help items-center justify-center rounded-xs outline-none focus-visible:shadow-(--focus) [&_svg]:size-3.5",
            SEVERITY_CLASS[severity],
            className,
          )}
          {...rest}
        >
          <Icon strokeWidth={1.75} aria-hidden="true" />
        </button>
      </Tooltip>
    );
  },
);
