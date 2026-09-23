import {
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type HTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  CircleCheck,
  Database,
  GitFork,
  ListTree,
  Pencil,
  Play,
  ScrollText,
  Settings2,
  Timer,
  X,
} from "lucide-react";
import { format, parseISO } from "date-fns";
import { cn } from "@/lib/cn";
import { formatMs } from "@/lib/format";
import type {
  ConfidenceThresholds,
  DecisionResult,
  Diagnostic,
  JsonSchema,
  LogLineView,
  NodeRunView,
  PortView,
  WorkflowNodeView,
} from "@/types";
import {
  Badge,
  Button,
  CategoryDot,
  CopyButton,
  EmptyState,
  Hint,
  IconButton,
  Input,
  ScrollArea,
  StatusChip,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  useControllableState,
} from "@/primitives";
import { DecisionCard } from "@/decision";
import { JsonView } from "@/data";
import { KeyValueList, type KeyValueItem } from "./KeyValueList";
import { PortTypeLabel } from "./PortTypeLabel";
import { SchemaTree } from "./SchemaTree";
import { TimingBreakdown, type NodeTiming } from "./TimingBreakdown";

export type InspectorTabId =
  "config" | "input" | "output" | "decision" | "timing" | "logs" | "state" | "errors";

export const INSPECTOR_TABS: readonly InspectorTabId[] = [
  "config",
  "input",
  "output",
  "decision",
  "timing",
  "logs",
  "state",
  "errors",
];

export function isInspectorTab(value: string): value is InspectorTabId {
  return INSPECTOR_TABS.some((t) => t === value);
}

const TAB_LABEL: Record<InspectorTabId, string> = {
  config: "Config",
  input: "Input",
  output: "Output",
  decision: "Decision",
  timing: "Timing",
  logs: "Logs",
  state: "State",
  errors: "Errors",
};

// ---------------------------------------------------------------------------
// Small internal pieces
// ---------------------------------------------------------------------------

function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return <h3 className={cn("text-eyebrow", className)}>{children}</h3>;
}

/**
 * Tab strip that fades at the edge it overflows towards and keeps the active
 * trigger in view, so eight tabs stay usable at 320px.
 */
function InspectorTabList({ active, children }: { active: string; children: ReactNode }) {
  const listRef = useRef<HTMLDivElement | null>(null);
  const [overflow, setOverflow] = useState<{ left: boolean; right: boolean }>({
    left: false,
    right: false,
  });

  const measure = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    const left = el.scrollLeft > 1;
    const right = el.scrollWidth - el.clientWidth - el.scrollLeft > 1;
    setOverflow((prev) => (prev.left === left && prev.right === right ? prev : { left, right }));
  }, []);

  useEffect(() => {
    measure();
    const el = listRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [measure]);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const trigger = el.querySelector<HTMLElement>('[data-state="active"]');
    if (trigger && typeof trigger.scrollIntoView === "function") {
      trigger.scrollIntoView({ inline: "nearest", block: "nearest" });
    }
    measure();
  }, [active, measure]);

  return (
    <div className="relative shrink-0">
      <TabsList
        ref={listRef}
        onScroll={measure}
        className="scrollbar-none gap-3 px-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {children}
      </TabsList>
      <span
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute inset-y-0 left-0 w-6 bg-gradient-to-r from-surface to-transparent transition-opacity duration-(--dur-fast)",
          overflow.left ? "opacity-100" : "opacity-0",
        )}
      />
      <span
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-surface to-transparent transition-opacity duration-(--dur-fast)",
          overflow.right ? "opacity-100" : "opacity-0",
        )}
      />
    </div>
  );
}

function InlineName({ name, onRename }: { name: string; onRename?: (name: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const cancelled = useRef(false);
  const hintId = useId();

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  const commit = useCallback(() => {
    setEditing(false);
    if (cancelled.current) {
      cancelled.current = false;
      return;
    }
    const next = draft.trim();
    if (next.length > 0 && next !== name) onRename?.(next);
  }, [draft, name, onRename]);

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      commit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancelled.current = true;
      setDraft(name);
      setEditing(false);
    }
  };

  if (!onRename) {
    return (
      <h2 className="min-w-0 flex-1 truncate text-sm font-semibold tracking-tight text-ink">
        {name}
      </h2>
    );
  }
  if (editing) {
    return (
      <Input
        ref={inputRef}
        size="sm"
        aria-label="Node name"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={commit}
        className="h-6 min-w-0 flex-1 text-sm font-semibold tracking-tight"
      />
    );
  }
  // The heading is the node name; the rename control sits inside it (a <button> may not
  // contain a heading). The button is named by the visible name (label-in-name) and
  // described as the rename action.
  return (
    <>
      <h2 className="flex h-6 min-w-0 flex-1 items-center text-sm font-semibold tracking-tight text-ink">
        <button
          type="button"
          onClick={() => {
            // The draft starts from the current name each time editing begins.
            setDraft(name);
            setEditing(true);
          }}
          aria-describedby={hintId}
          className="group/name flex h-6 min-w-0 max-w-full cursor-text items-center gap-1.5 rounded-xs text-left font-semibold"
        >
          <span className="min-w-0 truncate">{name}</span>
          <Pencil
            className="size-3 shrink-0 text-ink-3 opacity-0 transition-opacity duration-(--dur-fast) group-hover/name:opacity-100 group-focus-visible/name:opacity-100"
            strokeWidth={1.75}
            aria-hidden="true"
          />
        </button>
      </h2>
      <span id={hintId} className="sr-only">
        Rename node
      </span>
    </>
  );
}

function PortList({ ports }: { ports: readonly PortView[] }) {
  return (
    <ul className="flex flex-col divide-y divide-border rounded-sm border border-border bg-surface">
      {ports.map((p) => (
        <li key={p.id} className="flex min-w-0 flex-col gap-0.5 px-2 py-1.5">
          <span className="flex min-w-0 items-center gap-2">
            <span className="min-w-0 flex-1 truncate font-mono text-xs text-ink">{p.label}</span>
            <PortTypeLabel type={p.type} size="sm" required={p.required} />
          </span>
          {p.description ? <span className="text-2xs text-ink-3">{p.description}</span> : null}
        </li>
      ))}
    </ul>
  );
}

function fmtTime(iso: string | undefined, pattern = "HH:mm:ss.SSS"): string {
  if (!iso) return "—";
  try {
    return format(parseISO(iso), pattern);
  } catch {
    return iso;
  }
}

const LEVEL_TONE: Record<LogLineView["level"], "neutral" | "info" | "warn" | "danger"> = {
  debug: "neutral",
  info: "info",
  warn: "warn",
  error: "danger",
};

function LogList({ logs }: { logs: readonly LogLineView[] }) {
  return (
    <ol className="flex flex-col divide-y divide-border rounded-sm border border-border bg-surface">
      {logs.map((line, i) => (
        <li key={i} className="flex min-w-0 flex-col gap-1 px-2 py-1.5" data-level={line.level}>
          <div className="flex min-w-0 items-start gap-2">
            <span className="shrink-0 pt-px font-mono text-2xs text-ink-3 tabular">
              {fmtTime(line.at)}
            </span>
            <Badge
              tone={LEVEL_TONE[line.level]}
              size="sm"
              mono
              className="w-11 shrink-0 justify-center"
            >
              {line.level}
            </Badge>
            <span className="min-w-0 flex-1 break-words text-xs leading-4 text-ink">
              {line.message}
            </span>
          </div>
          {line.data !== undefined ? (
            <JsonView value={line.data} toolbar={false} expandDepth={1} className="pl-1" />
          ) : null}
        </li>
      ))}
    </ol>
  );
}

const SEVERITY_CLASS: Record<Diagnostic["severity"], string> = {
  error: "bg-danger",
  warning: "bg-warn",
  info: "bg-info",
};

/** The most specific location a diagnostic points at, for the mono meta line. */
export function diagnosticLocationLabel(d: Diagnostic): string | undefined {
  const loc = d.location;
  return loc.bindingPath ?? loc.path ?? (loc.port ? `port ${loc.port}` : undefined) ?? loc.edgeId;
}

/** Compiler diagnostics for a node, each with its quick fix when the compiler offered one. */
export function DiagnosticList({
  diagnostics,
  onApplyFix,
}: {
  diagnostics: readonly Diagnostic[];
  /** Applies `Diagnostic.fix.patch` (RFC 6902) to the definition; the button appears only with a fix and a handler. */
  onApplyFix?: (diagnostic: Diagnostic) => void;
}) {
  return (
    <ul className="flex flex-col divide-y divide-border rounded-sm border border-border bg-surface">
      {diagnostics.map((d, i) => {
        const where = diagnosticLocationLabel(d);
        return (
          <li
            key={`${d.code}-${i}`}
            className="flex items-start gap-2 px-2 py-1.5"
            data-severity={d.severity}
          >
            <span
              aria-hidden="true"
              className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", SEVERITY_CLASS[d.severity])}
            />
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="text-xs leading-4 text-ink">{d.message}</span>
              <span className="flex flex-wrap items-center gap-2 font-mono text-2xs text-ink-3">
                <span>{d.code}</span>
                {where ? <span>{where}</span> : null}
              </span>
              {d.related?.length ? (
                <ul className="m-0 flex list-none flex-col gap-0.5 p-0 text-2xs text-ink-3">
                  {d.related.map((r, j) => (
                    <li key={j}>
                      {r.nodeId ? <span className="font-mono">{r.nodeId} · </span> : null}
                      {r.message}
                    </li>
                  ))}
                </ul>
              ) : null}
            </span>
            {d.fix && onApplyFix ? (
              <Button
                size="sm"
                variant="secondary"
                className="shrink-0"
                onClick={() => onApplyFix(d)}
              >
                {d.fix.title}
              </Button>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Inspector
// ---------------------------------------------------------------------------

export interface InspectorProps extends Omit<HTMLAttributes<HTMLDivElement>, "children" | "title"> {
  node: WorkflowNodeView;
  /** The latest run of this node, when any. */
  nodeRun?: NodeRunView;
  inputSchema?: JsonSchema;
  outputSchema?: JsonSchema;
  /** Persistent node state (memory, checkpoint). */
  state?: unknown;
  /** Phase timing for the Timing tab; falls back to the run's duration as execution time. */
  timing?: NodeTiming;
  /** Confidence gate thresholds; shown as a meter under the decision. */
  thresholds?: ConfidenceThresholds;
  /** Which tabs to show, in order. Default: all. */
  tabs?: readonly InspectorTabId[];
  /** Hide tabs that have nothing to show (Config always stays). Default false. */
  hideEmptyTabs?: boolean;
  tab?: InspectorTabId;
  defaultTab?: InspectorTabId;
  onTabChange?: (tab: InspectorTabId) => void;
  onRename?: (name: string) => void;
  onClose?: () => void;
  onRunFromHere?: () => void;
  onOpenTrace?: () => void;
  /** Applies a diagnostic's quick fix (`Diagnostic.fix.patch`) to the definition. */
  onApplyFix?: (diagnostic: Diagnostic) => void;
  /** Fixed width in px, or "fill" to take the parent's width (inside a resizable panel). Default 320. */
  width?: number | "fill";
  /** Config tab content (forms/ injects the SchemaForm). */
  children?: ReactNode;
  /** Custom Decision tab body; defaults to a compact DecisionCard. */
  renderDecision?: (decision: DecisionResult, nodeRun: NodeRunView) => ReactNode;
}

/**
 * The right-hand inspector for a selected node: header with category dot,
 * inline-editable name, mono kind and provider; tabs for Config, Input,
 * Output, Decision (a compact DecisionCard), Timing, Logs, State and Errors with count badges; a
 * footer with the node id and the run/trace actions. Every tab has an empty
 * state that says what will appear after a run.
 */
export const Inspector = forwardRef<HTMLDivElement, InspectorProps>(function Inspector(
  {
    node,
    nodeRun,
    inputSchema,
    outputSchema,
    state,
    timing,
    thresholds,
    tabs = INSPECTOR_TABS,
    hideEmptyTabs = false,
    tab,
    defaultTab,
    onTabChange,
    onRename,
    onClose,
    onRunFromHere,
    onOpenTrace,
    onApplyFix,
    width = 320,
    children,
    renderDecision,
    className,
    style,
    ...rest
  },
  ref,
) {
  const logs = nodeRun?.logs ?? [];
  const diagnostics = node.diagnostics ?? [];
  const errorCount =
    (nodeRun?.error ? 1 : 0) + diagnostics.filter((d) => d.severity === "error").length;
  const warningCount = diagnostics.filter((d) => d.severity !== "error").length;

  const hasData: Record<InspectorTabId, boolean> = {
    config: true,
    input: nodeRun?.input !== undefined || inputSchema !== undefined || node.inputs.length > 0,
    output: nodeRun?.output !== undefined || outputSchema !== undefined || node.outputs.length > 0,
    decision: nodeRun?.decision !== undefined,
    timing:
      nodeRun !== undefined &&
      (nodeRun.durationMs !== undefined || nodeRun.startedAt !== undefined || timing !== undefined),
    logs: logs.length > 0,
    state: state !== undefined,
    errors: errorCount + warningCount > 0,
  };
  const counts: Partial<Record<InspectorTabId, number>> = {
    logs: logs.length > 0 ? logs.length : undefined,
    errors: errorCount > 0 ? errorCount : undefined,
  };
  const visibleTabs = tabs.filter((t) => t === "config" || !hideEmptyTabs || hasData[t]);
  const firstTab = visibleTabs[0] ?? "config";

  const [current, setCurrent] = useControllableState<InspectorTabId>(
    tab,
    defaultTab ?? firstTab,
    onTabChange,
  );
  const active = visibleTabs.includes(current) ? current : firstTab;

  const fixed = width !== "fill";
  const durationMeta = nodeRun?.durationMs !== undefined ? formatMs(nodeRun.durationMs) : undefined;

  const runDetails: KeyValueItem[] = nodeRun
    ? [
        {
          label: "Started",
          value: fmtTime(nodeRun.startedAt),
          mono: true,
          copyValue: nodeRun.startedAt,
        },
        { label: "Ended", value: fmtTime(nodeRun.endedAt), mono: true, copyValue: nodeRun.endedAt },
        { label: "Duration", value: durationMeta ?? "—", mono: true },
        { label: "Attempt", value: String(nodeRun.attempt), mono: true },
        ...(nodeRun.iteration
          ? [{ label: "Iteration", value: nodeRun.iteration.join("."), mono: true }]
          : []),
      ]
    : [];

  const renderTab = (id: InspectorTabId): ReactNode => {
    switch (id) {
      case "config":
        return children !== undefined && children !== null ? (
          children
        ) : (
          <EmptyState
            size="sm"
            icon={<Settings2 strokeWidth={1.75} />}
            title="Nothing to configure"
            description="This node runs with its defaults."
          />
        );
      case "input":
        return (
          <div className="flex flex-col gap-4">
            {nodeRun?.input !== undefined ? (
              <section className="flex flex-col gap-2">
                <Eyebrow>Received</Eyebrow>
                <JsonView value={nodeRun.input} expandDepth={2} />
              </section>
            ) : (
              <EmptyState
                size="sm"
                icon={<ArrowDownToLine strokeWidth={1.75} />}
                title="No input yet"
                description="The values this node received appear here after a run."
              />
            )}
            {inputSchema ? (
              <section className="flex flex-col gap-2">
                <Eyebrow>Schema</Eyebrow>
                <SchemaTree schema={inputSchema} />
              </section>
            ) : null}
            {node.inputs.length > 0 ? (
              <section className="flex flex-col gap-2">
                <Eyebrow>Ports</Eyebrow>
                <PortList ports={node.inputs} />
              </section>
            ) : null}
          </div>
        );
      case "output":
        return (
          <div className="flex flex-col gap-4">
            {nodeRun?.output !== undefined ? (
              <section className="flex flex-col gap-2">
                <Eyebrow>Produced</Eyebrow>
                <JsonView value={nodeRun.output} expandDepth={2} />
              </section>
            ) : (
              <EmptyState
                size="sm"
                icon={<ArrowUpFromLine strokeWidth={1.75} />}
                title="No output yet"
                description="What this node produced appears here after a run."
              />
            )}
            {nodeRun?.routeTaken ? (
              <KeyValueList
                items={[{ label: "Route taken", value: nodeRun.routeTaken, mono: true }]}
                dense
              />
            ) : null}
            {outputSchema ? (
              <section className="flex flex-col gap-2">
                <Eyebrow>Schema</Eyebrow>
                <SchemaTree schema={outputSchema} />
              </section>
            ) : null}
            {node.outputs.length > 0 ? (
              <section className="flex flex-col gap-2">
                <Eyebrow>Ports</Eyebrow>
                <PortList ports={node.outputs} />
              </section>
            ) : null}
          </div>
        );
      case "decision":
        return nodeRun?.decision ? (
          renderDecision ? (
            renderDecision(nodeRun.decision, nodeRun)
          ) : (
            <DecisionCard result={nodeRun.decision} thresholds={thresholds} compact />
          )
        ) : (
          <EmptyState
            size="sm"
            icon={<GitFork strokeWidth={1.75} />}
            title="No decision yet"
            description="The chosen value, its probabilities and confidence appear here after a run."
          />
        );
      case "timing":
        return nodeRun && hasData.timing ? (
          <div className="flex flex-col gap-4">
            <TimingBreakdown
              timing={timing ?? { executionMs: nodeRun.durationMs ?? 0 }}
              totalMs={timing ? undefined : nodeRun.durationMs}
            />
            <KeyValueList items={runDetails} dense />
          </div>
        ) : (
          <EmptyState
            size="sm"
            icon={<Timer strokeWidth={1.75} />}
            title="No timing yet"
            description="Queue wait, execution, retries and human wait appear here after a run."
          />
        );
      case "logs":
        return logs.length > 0 ? (
          <LogList logs={logs} />
        ) : (
          <EmptyState
            size="sm"
            icon={<ScrollText strokeWidth={1.75} />}
            title="No logs"
            description="Lines this node logs appear here after a run."
          />
        );
      case "state":
        return state !== undefined ? (
          <JsonView value={state} expandDepth={2} />
        ) : (
          <EmptyState
            size="sm"
            icon={<Database strokeWidth={1.75} />}
            title="No state"
            description="Memory and checkpoint values appear here after a run."
          />
        );
      case "errors":
        return errorCount + warningCount > 0 ? (
          <div className="flex flex-col gap-3">
            {nodeRun?.error ? (
              <div
                className="flex flex-col gap-1.5 rounded-md border border-danger/30 bg-danger-soft/50 px-3 py-2.5"
                role="alert"
              >
                <div className="flex items-center gap-2">
                  <span className="font-mono text-2xs text-danger-text">{nodeRun.error.code}</span>
                  {nodeRun.error.retryable !== undefined ? (
                    <Badge tone={nodeRun.error.retryable ? "warn" : "neutral"} size="sm">
                      {nodeRun.error.retryable ? "retryable" : "not retryable"}
                    </Badge>
                  ) : null}
                  {nodeRun.attempt > 1 ? (
                    <span className="ml-auto font-mono text-2xs text-ink-3">
                      attempt {nodeRun.attempt}
                    </span>
                  ) : null}
                </div>
                <p className="text-xs leading-snug text-ink">{nodeRun.error.message}</p>
              </div>
            ) : null}
            {diagnostics.length > 0 ? (
              <section className="flex flex-col gap-2">
                <Eyebrow>Diagnostics</Eyebrow>
                <DiagnosticList diagnostics={diagnostics} onApplyFix={onApplyFix} />
              </section>
            ) : null}
          </div>
        ) : (
          <EmptyState
            size="sm"
            icon={<CircleCheck strokeWidth={1.75} />}
            title="No errors"
            description="Failures and diagnostics for this node appear here."
          />
        );
    }
  };

  return (
    <div
      ref={ref}
      data-node-id={node.id}
      className={cn(
        "flex h-full min-h-0 min-w-0 flex-col bg-surface text-ink",
        fixed && "shrink-0",
        className,
      )}
      style={{ width: fixed ? width : undefined, ...style }}
      {...rest}
    >
      <header className="flex shrink-0 flex-col gap-1.5 border-b border-border px-3 pb-2 pt-2.5">
        <div className="flex h-6 min-w-0 items-center gap-2">
          <CategoryDot category={node.category} />
          <InlineName name={node.name} onRename={onRename} />
          <span className="shrink-0 font-mono text-2xs tracking-wide text-ink-3">
            {node.nodeType ?? node.kind}
          </span>
          {onClose ? (
            <IconButton label="Close inspector" size="sm" onClick={onClose} className="-mr-1">
              <X strokeWidth={1.75} />
            </IconButton>
          ) : null}
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-1.5 pl-4">
          {nodeRun ? (
            <StatusChip status={nodeRun.status} size="sm" meta={durationMeta} />
          ) : (
            <Badge tone="neutral" size="sm" dot className="text-ink-3">
              Not run
            </Badge>
          )}
          {node.provider ? (
            <Badge tone="outline" mono size="sm" className="text-ink-3">
              {node.provider}
            </Badge>
          ) : null}
          {node.disabled ? (
            <Badge tone="neutral" size="sm">
              Disabled
            </Badge>
          ) : null}
          {node.description ? (
            <Hint
              hint={node.description}
              announce={false}
              className="basis-full truncate text-2xs text-ink-3"
            >
              {node.description}
            </Hint>
          ) : null}
        </div>
      </header>

      <Tabs
        size="sm"
        value={active}
        onValueChange={(v) => {
          if (isInspectorTab(v)) setCurrent(v);
        }}
        className="min-h-0 flex-1"
      >
        <InspectorTabList active={active}>
          {visibleTabs.map((id) => (
            <TabsTrigger
              key={id}
              value={id}
              count={counts[id]}
              className={cn(
                id === "errors" && counts.errors !== undefined && "[&>span]:text-danger-text",
              )}
            >
              {TAB_LABEL[id]}
            </TabsTrigger>
          ))}
        </InspectorTabList>
        {visibleTabs.map((id) => (
          <TabsContent key={id} value={id} className="flex min-h-0 flex-1 flex-col">
            <ScrollArea className="min-h-0 flex-1" viewportClassName="[&>div]:min-w-0">
              <div className="p-3">{renderTab(id)}</div>
            </ScrollArea>
          </TabsContent>
        ))}
      </Tabs>

      <footer className="flex h-10 shrink-0 items-center gap-1 border-t border-border px-3">
        <Hint
          hint={node.id}
          announce={false}
          className="min-w-0 flex-1 truncate font-mono text-2xs text-ink-3"
        >
          {node.id}
        </Hint>
        <CopyButton value={node.id} label="Copy node id" size="xs" className="text-ink-3" />
        {onRunFromHere ? (
          <Button
            size="sm"
            variant="secondary"
            leadingIcon={<Play strokeWidth={1.75} />}
            onClick={onRunFromHere}
            className="ml-1"
          >
            Run from here
          </Button>
        ) : null}
        {onOpenTrace ? (
          <Button
            size="sm"
            variant="ghost"
            leadingIcon={<ListTree strokeWidth={1.75} />}
            onClick={onOpenTrace}
          >
            Open trace
          </Button>
        ) : null}
      </footer>
    </div>
  );
});
