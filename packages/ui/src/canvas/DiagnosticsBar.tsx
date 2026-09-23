import { forwardRef, useMemo, type HTMLAttributes } from "react";
import { AlertTriangle, ChevronUp, CircleAlert, Info } from "lucide-react";
import { cn } from "@/lib/cn";
import {
  Button,
  CollapsibleContent,
  CollapsibleRoot,
  CollapsibleTrigger,
  Hint,
  useControllableState,
} from "@/primitives";
import type { Diagnostic } from "@/types";

export interface DiagnosticsBarProps extends Omit<HTMLAttributes<HTMLDivElement>, "children"> {
  diagnostics: Diagnostic[];
  /** Resolves a node id to its display name. */
  nodeName?: (nodeId: string) => string | undefined;
  onFocusNode?: (nodeId: string) => void;
  onFocusEdge?: (edgeId: string) => void;
  /** Applies a diagnostic's quick fix (`Diagnostic.fix.patch`, RFC 6902) to the definition; shows a button per fixable row. */
  onApplyFix?: (diagnostic: Diagnostic) => void;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Maximum rows visible before the list scrolls. */
  maxRows?: number;
}

const SEVERITY_ORDER: Record<Diagnostic["severity"], number> = { error: 0, warning: 1, info: 2 };

/** The most specific location a diagnostic points at, for the mono meta column. */
export function diagnosticPath(d: Diagnostic): string | undefined {
  return (
    d.location.bindingPath ??
    d.location.path ??
    (d.location.port ? `port ${d.location.port}` : undefined)
  );
}

function SeverityIcon({
  severity,
  className,
}: {
  severity: Diagnostic["severity"];
  className?: string;
}) {
  const props = {
    strokeWidth: 1.75,
    "aria-hidden": true,
    className: cn("size-3.5 shrink-0", className),
  } as const;
  if (severity === "error") return <CircleAlert {...props} />;
  if (severity === "warning") return <AlertTriangle {...props} />;
  return <Info {...props} />;
}

const SEVERITY_TEXT: Record<Diagnostic["severity"], string> = {
  error: "text-danger-text",
  warning: "text-warn-text",
  info: "text-info-text",
};

/**
 * Slim bar for compiler diagnostics at the bottom of the canvas. The header
 * shows counts by severity; opening it lists every diagnostic, a row focuses
 * the node (or edge) it points at, and rows with a compiler quick fix carry
 * an "Apply" button.
 */
export const DiagnosticsBar = forwardRef<HTMLDivElement, DiagnosticsBarProps>(
  function DiagnosticsBar(
    {
      diagnostics,
      nodeName,
      onFocusNode,
      onFocusEdge,
      onApplyFix,
      open,
      defaultOpen = false,
      onOpenChange,
      maxRows = 6,
      className,
      ...rest
    },
    ref,
  ) {
    const [isOpen, setOpen] = useControllableState(open, defaultOpen, onOpenChange);
    const sorted = useMemo(
      () =>
        [...diagnostics].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]),
      [diagnostics],
    );
    const errors = diagnostics.filter((d) => d.severity === "error").length;
    const warnings = diagnostics.filter((d) => d.severity === "warning").length;
    const infos = diagnostics.length - errors - warnings;
    const summary =
      diagnostics.length === 0
        ? "No diagnostics"
        : [
            errors > 0 ? `${errors} error${errors === 1 ? "" : "s"}` : null,
            warnings > 0 ? `${warnings} warning${warnings === 1 ? "" : "s"}` : null,
            infos > 0 ? `${infos} note${infos === 1 ? "" : "s"}` : null,
          ]
            .filter(Boolean)
            .join(", ");

    return (
      <CollapsibleRoot open={isOpen} onOpenChange={setOpen} asChild>
        <div
          ref={ref}
          className={cn("flex flex-col border-t border-border bg-surface text-xs", className)}
          aria-label="Diagnostics"
          {...rest}
        >
          <CollapsibleContent className="pb-0 pt-0">
            <ul
              className="divide-y divide-border overflow-y-auto border-b border-border"
              style={{ maxHeight: maxRows * 28 }}
            >
              {sorted.map((d, i) => {
                const nodeId = d.location.nodeId;
                const edgeId = d.location.edgeId;
                const target = nodeId ?? edgeId;
                const name = nodeId
                  ? (nodeName?.(nodeId) ?? nodeId)
                  : edgeId
                    ? `edge ${edgeId}`
                    : undefined;
                const path = diagnosticPath(d);
                const focus = () => {
                  if (nodeId) onFocusNode?.(nodeId);
                  else if (edgeId) onFocusEdge?.(edgeId);
                };
                return (
                  <li key={`${d.code}-${target ?? "global"}-${i}`} className="flex items-center">
                    <button
                      type="button"
                      onClick={focus}
                      disabled={!target}
                      className={cn(
                        "flex h-7 min-w-0 flex-1 items-center gap-2 px-3 text-left transition-colors duration-(--dur-fast)",
                        target ? "cursor-pointer hover:bg-surface-3" : "cursor-default",
                      )}
                    >
                      <SeverityIcon severity={d.severity} className={SEVERITY_TEXT[d.severity]} />
                      {name ? <span className="shrink-0 font-medium text-ink">{name}</span> : null}
                      <Hint
                        hint={d.message}
                        announce={false}
                        className="min-w-0 flex-1 truncate text-ink-2"
                      >
                        {d.message}
                      </Hint>
                      {path ? (
                        <span className="hidden shrink-0 font-mono text-2xs text-ink-3 sm:inline">
                          {path}
                        </span>
                      ) : null}
                      <span className="shrink-0 font-mono text-2xs text-ink-3">{d.code}</span>
                    </button>
                    {d.fix && onApplyFix ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="mr-2 shrink-0"
                        onClick={() => onApplyFix(d)}
                      >
                        {d.fix.title}
                      </Button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </CollapsibleContent>
          <CollapsibleTrigger
            noChevron
            disabled={diagnostics.length === 0}
            className="h-7 shrink-0 gap-3 rounded-none px-3 font-normal hover:bg-surface-2 data-[state=open]:bg-surface-2 disabled:opacity-100"
            meta={
              diagnostics.length > 0 ? (
                <ChevronUp
                  className={cn(
                    "size-3.5 shrink-0 text-ink-3 transition-transform duration-(--dur-fast) ease-(--ease-out)",
                    isOpen && "rotate-180",
                  )}
                  strokeWidth={1.75}
                  aria-hidden="true"
                />
              ) : undefined
            }
          >
            <span className="flex items-center gap-3">
              <span
                className={cn(
                  "inline-flex items-center gap-1 font-mono text-2xs tabular",
                  errors > 0 ? "text-danger-text" : "text-ink-3",
                )}
              >
                <SeverityIcon severity="error" />
                {errors}
              </span>
              <span
                className={cn(
                  "inline-flex items-center gap-1 font-mono text-2xs tabular",
                  warnings > 0 ? "text-warn-text" : "text-ink-3",
                )}
              >
                <SeverityIcon severity="warning" />
                {warnings}
              </span>
              {infos > 0 ? (
                <span className="inline-flex items-center gap-1 font-mono text-2xs tabular text-info-text">
                  <SeverityIcon severity="info" />
                  {infos}
                </span>
              ) : null}
              <span className="text-ink-3">{summary}</span>
            </span>
          </CollapsibleTrigger>
        </div>
      </CollapsibleRoot>
    );
  },
);
