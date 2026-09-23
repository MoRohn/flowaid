import {
  forwardRef,
  useCallback,
  useEffect,
  useRef,
  useState,
  type HTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import {
  CircleAlert,
  CornerDownLeft,
  Database,
  GitFork,
  KeyRound,
  ListChecks,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  Target,
  UserCheck,
  Wrench,
} from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { cn } from "@/lib/cn";
import type { NodeCategory } from "@/lib/categories";
import { Badge, Button, CategoryDot, Kbd, Panel, Skeleton, Textarea } from "@/primitives";
import type { ConfidenceThresholds, DecisionKind } from "@/types";
import { MiniGraph } from "./MiniGraph";
import { ThresholdMeter } from "./ThresholdMeter";

export interface BuilderPlanDecision {
  id: string;
  kind: DecisionKind;
  question: string;
  /** Choice options or score levels, when known. */
  options?: string[];
}

export interface BuilderPlanTool {
  id: string;
  name: string;
  /** Tool kind label, e.g. "HTTP", "MCP". */
  kind?: string;
  credential?: { type: string; configured: boolean };
}

export interface BuilderPlanRisk {
  id: string;
  action: string;
  /** Name of the approval gate that guards this action. */
  gate: string;
}

export interface BuilderPlanThreshold {
  nodeId: string;
  label: string;
  thresholds: ConfidenceThresholds;
}

export interface BuilderPlanNode {
  id: string;
  name: string;
  /** Node definition id, e.g. "decision.choice". */
  type: string;
  category: NodeCategory;
}

export interface BuilderPlanEdge {
  source: string;
  target: string;
  label?: string;
}

/** A plan as the builder streams it in. Every section is optional so a partial object renders. */
export interface BuilderPlan {
  outcome?: string;
  decisions?: BuilderPlanDecision[];
  steps?: string[];
  tools?: BuilderPlanTool[];
  risks?: BuilderPlanRisk[];
  approvalGates?: string[];
  thresholds?: BuilderPlanThreshold[];
  dataRequirements?: string[];
  workflow?: { nodes: BuilderPlanNode[]; edges: BuilderPlanEdge[] };
  missingCredentials?: string[];
}

export type AIBuilderStatus = "idle" | "streaming" | "done" | "error";

export interface AIBuilderPanelProps extends Omit<HTMLAttributes<HTMLDivElement>, "onSubmit"> {
  plan?: BuilderPlan | null;
  status: AIBuilderStatus;
  /** Message shown in the error state. */
  error?: string;
  /** The prompt the current plan answers; echoed above the plan. */
  prompt?: string;
  examplePrompts?: string[];
  onSubmit: (prompt: string) => void;
  onApply?: () => void;
  onDiscard?: () => void;
  /** Follow-up prompt against the current plan. Falls back to onSubmit. */
  onRefine?: (prompt: string) => void;
  onRetry?: () => void;
  onConfigureCredential?: (name: string) => void;
  /** Panel title. */
  title?: string;
  /** Render without the panel chrome (inside a sheet or another panel). */
  flush?: boolean;
}

const DEFAULT_EXAMPLES = [
  "Triage inbound support tickets by intent and urgency, escalate low-confidence cases",
  "Summarise a GitHub issue, label it and assign an owner",
  "Extract invoice fields from PDFs and post them to the ledger API",
];

const KIND_LABEL: Record<DecisionKind, string> = {
  boolean: "boolean",
  choice: "choice",
  score: "score",
};

function isMod(e: KeyboardEvent): boolean {
  return e.metaKey || e.ctrlKey;
}

function Section({
  icon,
  title,
  count,
  children,
  animate,
}: {
  icon: ReactNode;
  title: string;
  count?: number;
  children: ReactNode;
  animate: boolean;
}) {
  return (
    <motion.section
      initial={animate ? { opacity: 0, y: 4 } : false}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: [0.2, 0.8, 0.2, 1] }}
      className="flex flex-col gap-2"
    >
      <header className="flex items-center gap-1.5">
        <span className="text-ink-3 [&_svg]:size-3.5">{icon}</span>
        <h3 className="text-eyebrow">{title}</h3>
        {count !== undefined ? (
          <span className="font-mono text-2xs text-ink-3 tabular">{count}</span>
        ) : null}
      </header>
      {children}
    </motion.section>
  );
}

/**
 * The AI builder: a prompt composer plus a structured plan that fills in as
 * it streams. The plan is pure data; the app feeds partial objects as the
 * model emits sections, and this panel renders whatever is present with
 * skeleton lines and a cursor after the last section while streaming.
 */
export const AIBuilderPanel = forwardRef<HTMLDivElement, AIBuilderPanelProps>(
  function AIBuilderPanel(
    {
      plan,
      status,
      error,
      prompt: activePrompt,
      examplePrompts = DEFAULT_EXAMPLES,
      onSubmit,
      onApply,
      onDiscard,
      onRefine,
      onRetry,
      onConfigureCredential,
      title = "Build with AI",
      flush = false,
      className,
      ...rest
    },
    ref,
  ) {
    const reduced = useReducedMotion();
    const animate = !reduced && status === "streaming";
    const [draft, setDraft] = useState("");
    const [refining, setRefining] = useState(false);
    const refineRef = useRef<HTMLTextAreaElement | null>(null);
    const streaming = status === "streaming";
    const hasPlan = Boolean(plan && Object.keys(plan).length > 0);

    useEffect(() => {
      if (refining) refineRef.current?.focus();
    }, [refining]);

    const submit = useCallback(() => {
      const text = draft.trim();
      if (!text || streaming) return;
      if (refining && onRefine) onRefine(text);
      else onSubmit(text);
      setDraft("");
      setRefining(false);
    }, [draft, streaming, refining, onRefine, onSubmit]);

    const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && isMod(e)) {
        e.preventDefault();
        submit();
      }
      if (e.key === "Escape" && refining) {
        e.preventDefault();
        setRefining(false);
        setDraft("");
      }
    };

    const composer = (mode: "initial" | "refine") => (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="flex flex-col gap-2"
      >
        <Textarea
          ref={mode === "refine" ? refineRef : undefined}
          autoGrow
          minRows={mode === "refine" ? 2 : 3}
          maxRows={10}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={streaming}
          aria-label={mode === "refine" ? "Refine the plan" : "Describe the workflow"}
          placeholder={
            mode === "refine"
              ? "What should change? e.g. route billing intents to the finance queue"
              : "Describe what the workflow should do, who it serves and what must never happen automatically"
          }
        />
        {mode === "initial" && examplePrompts.length > 0 && !draft ? (
          <div className="flex flex-wrap gap-1.5">
            {examplePrompts.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setDraft(p)}
                className="line-clamp-1 max-w-full min-w-0 rounded-full border border-border bg-surface px-2.5 py-1 text-left text-2xs leading-4 text-ink-2 transition-colors duration-(--dur-fast) hover:border-border-strong hover:bg-surface-3 hover:text-ink"
              >
                {p}
              </button>
            ))}
          </div>
        ) : null}
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1 text-2xs text-ink-3">
            <Kbd size="sm">⌘</Kbd>
            <Kbd size="sm">
              <CornerDownLeft className="size-2.5" strokeWidth={2} aria-hidden="true" />
            </Kbd>
            to submit
          </span>
          <div className="ml-auto flex items-center gap-1.5">
            {mode === "refine" ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setRefining(false);
                  setDraft("");
                }}
              >
                Cancel
              </Button>
            ) : null}
            <Button
              type="submit"
              size="sm"
              variant="primary"
              disabled={!draft.trim()}
              loading={streaming}
              leadingIcon={<Sparkles strokeWidth={1.75} aria-hidden="true" />}
            >
              {mode === "refine" ? "Refine plan" : "Generate plan"}
            </Button>
          </div>
        </div>
      </form>
    );

    const p = plan ?? {};
    const nodeName = (id: string) => p.workflow?.nodes.find((n) => n.id === id)?.name ?? id;

    const body = (
      <div className="flex flex-col gap-5">
        {status === "idle" || (!hasPlan && status !== "streaming" && status !== "error")
          ? composer("initial")
          : null}

        {activePrompt && status !== "idle" ? (
          <div className="flex items-start gap-2 rounded-md border border-border bg-surface-2 px-3 py-2 text-xs text-ink-2">
            <Sparkles
              className="mt-0.5 size-3.5 shrink-0 text-accent"
              strokeWidth={1.75}
              aria-hidden="true"
            />
            <p className="min-w-0 flex-1">{activePrompt}</p>
          </div>
        ) : null}

        {status === "error" ? (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-md border border-danger/30 bg-danger-soft px-3 py-2.5"
          >
            <CircleAlert
              className="mt-0.5 size-4 shrink-0 text-danger-text"
              strokeWidth={1.75}
              aria-hidden="true"
            />
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <p className="text-xs font-medium text-ink">The plan could not be generated</p>
              <p className="text-xs text-ink-2">
                {error ?? "The builder model did not return a plan. Retry, or shorten the prompt."}
              </p>
              <div className="flex gap-1.5 pt-0.5">
                <Button
                  size="sm"
                  onClick={onRetry}
                  leadingIcon={<RefreshCw strokeWidth={1.75} aria-hidden="true" />}
                >
                  Retry
                </Button>
                <Button size="sm" variant="ghost" onClick={onDiscard}>
                  Discard
                </Button>
              </div>
            </div>
          </div>
        ) : null}

        {p.outcome !== undefined ? (
          <Section icon={<Target strokeWidth={1.75} />} title="Outcome" animate={animate}>
            <p className="text-sm text-ink">{p.outcome}</p>
          </Section>
        ) : null}

        {p.decisions ? (
          <Section
            icon={<GitFork strokeWidth={1.75} />}
            title="Decisions to make"
            count={p.decisions.length}
            animate={animate}
          >
            <ul className="flex flex-col gap-1.5">
              {p.decisions.map((d) => (
                <li
                  key={d.id}
                  className="flex items-start gap-2 rounded-md border border-border px-2.5 py-2"
                >
                  <Badge tone="accent" mono className="mt-px">
                    {KIND_LABEL[d.kind]}
                  </Badge>
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <p className="text-xs text-ink">{d.question}</p>
                    {d.options && d.options.length > 0 ? (
                      <p className="font-mono text-2xs text-ink-3">{d.options.join(" · ")}</p>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          </Section>
        ) : null}

        {p.steps ? (
          <Section
            icon={<ListChecks strokeWidth={1.75} />}
            title="Deterministic steps"
            count={p.steps.length}
            animate={animate}
          >
            <ol className="flex flex-col gap-1">
              {p.steps.map((s, i) => (
                <li key={i} className="flex items-baseline gap-2 text-xs text-ink-2">
                  <span className="w-4 shrink-0 text-right font-mono text-2xs text-ink-3 tabular">
                    {i + 1}
                  </span>
                  <span>{s}</span>
                </li>
              ))}
            </ol>
          </Section>
        ) : null}

        {p.tools ? (
          <Section
            icon={<Wrench strokeWidth={1.75} />}
            title="Tools needed"
            count={p.tools.length}
            animate={animate}
          >
            <ul className="flex flex-col gap-1">
              {p.tools.map((t) => (
                <li key={t.id} className="flex h-7 items-center gap-2 text-xs">
                  <CategoryDot category="tool" size={6} />
                  <span className="text-ink">{t.name}</span>
                  {t.kind ? <span className="font-mono text-2xs text-ink-3">{t.kind}</span> : null}
                  {t.credential ? (
                    <Badge
                      tone={t.credential.configured ? "ok" : "warn"}
                      icon={<KeyRound strokeWidth={1.75} aria-hidden="true" />}
                      className="ml-auto"
                      mono
                    >
                      {t.credential.type}
                      {t.credential.configured ? "" : " · missing"}
                    </Badge>
                  ) : null}
                </li>
              ))}
            </ul>
          </Section>
        ) : null}

        {p.risks ? (
          <Section
            icon={<ShieldAlert strokeWidth={1.75} />}
            title="Risky actions"
            count={p.risks.length}
            animate={animate}
          >
            <ul className="flex flex-col gap-1.5">
              {p.risks.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-2 text-xs">
                  <Badge tone="danger">risky</Badge>
                  <span className="text-ink">{r.action}</span>
                  <span className="text-ink-3" aria-hidden="true">
                    →
                  </span>
                  <span className="inline-flex items-center gap-1 text-ink-2">
                    <UserCheck
                      className="size-3.5 text-cat-human"
                      strokeWidth={1.75}
                      aria-hidden="true"
                    />
                    {r.gate}
                  </span>
                </li>
              ))}
            </ul>
          </Section>
        ) : null}

        {p.approvalGates ? (
          <Section
            icon={<UserCheck strokeWidth={1.75} />}
            title="Approval gates"
            count={p.approvalGates.length}
            animate={animate}
          >
            <div className="flex flex-wrap gap-1.5">
              {p.approvalGates.map((g) => (
                <Badge key={g} category="human" dot>
                  {g}
                </Badge>
              ))}
            </div>
          </Section>
        ) : null}

        {p.thresholds ? (
          <Section
            icon={<Sparkles strokeWidth={1.75} />}
            title="Confidence thresholds"
            count={p.thresholds.length}
            animate={animate}
          >
            <ul className="flex flex-col gap-2.5">
              {p.thresholds.map((t) => (
                <li key={t.nodeId} className="flex flex-col gap-1">
                  <div className="flex items-center gap-2 text-xs">
                    <CategoryDot category="decision" size={6} />
                    <span className="text-ink">{t.label}</span>
                    <span className="ml-auto font-mono text-2xs text-ink-3 tabular">
                      review ≥ {t.thresholds.review.toFixed(2)} · auto ≥{" "}
                      {t.thresholds.auto.toFixed(2)}
                    </span>
                  </div>
                  <ThresholdMeter thresholds={t.thresholds} />
                </li>
              ))}
            </ul>
          </Section>
        ) : null}

        {p.dataRequirements ? (
          <Section
            icon={<Database strokeWidth={1.75} />}
            title="Data requirements"
            count={p.dataRequirements.length}
            animate={animate}
          >
            <ul className="flex flex-col gap-1">
              {p.dataRequirements.map((d) => (
                <li key={d} className="flex items-baseline gap-2 text-xs text-ink-2">
                  <span
                    className="mt-1.5 size-1 shrink-0 rounded-full bg-ink-4"
                    aria-hidden="true"
                  />
                  <span>{d}</span>
                </li>
              ))}
            </ul>
          </Section>
        ) : null}

        {p.workflow ? (
          <Section
            icon={<GitFork strokeWidth={1.75} />}
            title="Proposed workflow"
            count={p.workflow.nodes.length}
            animate={animate}
          >
            <div className="overflow-hidden rounded-md border border-border">
              <div className="flex items-center justify-center border-b border-border bg-surface-2 px-3 py-2 canvas-grid">
                <MiniGraph
                  nodes={p.workflow.nodes}
                  edges={p.workflow.edges}
                  width={280}
                  height={88}
                />
              </div>
              <ul className="divide-y divide-border">
                {p.workflow.nodes.map((n) => (
                  <li key={n.id} className="flex h-7 items-center gap-2 px-2.5 text-xs">
                    <CategoryDot category={n.category} size={6} />
                    <span className="min-w-0 truncate font-medium text-ink">{n.name}</span>
                    <span className="ml-auto shrink-0 font-mono text-2xs text-ink-3">{n.type}</span>
                  </li>
                ))}
              </ul>
              <p className="border-t border-border bg-surface-2 px-2.5 py-1.5 font-mono text-2xs text-ink-3 tabular">
                {p.workflow.edges.length} edges
                {p.workflow.edges.filter((e) => e.label).length > 0
                  ? ` · ${p.workflow.edges
                      .filter((e) => e.label)
                      .map(
                        (e) =>
                          `${nodeName(e.source)} →${e.label ? ` ${e.label} →` : ""} ${nodeName(e.target)}`,
                      )
                      .join(", ")}`
                  : ""}
              </p>
            </div>
          </Section>
        ) : null}

        {p.missingCredentials && p.missingCredentials.length > 0 ? (
          <div className="flex items-start gap-2 rounded-md border border-warn/30 bg-warn-soft px-3 py-2.5">
            <KeyRound
              className="mt-0.5 size-4 shrink-0 text-warn-text"
              strokeWidth={1.75}
              aria-hidden="true"
            />
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <p className="text-xs font-medium text-ink">
                {p.missingCredentials.length === 1
                  ? "1 credential"
                  : `${p.missingCredentials.length} credentials`}{" "}
                to configure before the first run
              </p>
              <ul className="flex flex-wrap gap-1.5">
                {p.missingCredentials.map((c) => (
                  <li key={c}>
                    <button
                      type="button"
                      onClick={() => onConfigureCredential?.(c)}
                      className="inline-flex h-5 items-center gap-1 rounded-xs border border-warn/30 bg-surface px-1.5 font-mono text-2xs text-ink-2 hover:text-ink"
                    >
                      {c}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ) : null}

        {streaming ? (
          <div aria-live="polite" aria-busy="true" className="flex flex-col gap-2">
            <span className="sr-only">Generating plan</span>
            <div className="flex items-center gap-1">
              <Skeleton variant="text" width="38%" />
              <span aria-hidden="true" className="fa-cursor h-3 w-0.5 bg-accent" />
            </div>
            <Skeleton lines={3} />
          </div>
        ) : null}

        {status === "done" && hasPlan ? (
          refining ? (
            composer("refine")
          ) : (
            <div className="flex flex-wrap items-center gap-1.5 border-t border-border pt-3">
              <Button variant="primary" onClick={onApply}>
                Apply to canvas
              </Button>
              <Button onClick={() => setRefining(true)}>Refine</Button>
              <Button variant="ghost" className="ml-auto" onClick={onDiscard}>
                Discard
              </Button>
            </div>
          )
        ) : null}
      </div>
    );

    return (
      <Panel
        ref={ref}
        title={title}
        icon={<Sparkles strokeWidth={1.75} aria-hidden="true" />}
        meta={
          status === "streaming"
            ? "streaming"
            : status === "done"
              ? "plan ready"
              : status === "error"
                ? "error"
                : undefined
        }
        flush={flush}
        className={cn("fa-builder", className)}
        data-status={status}
        {...rest}
      >
        {body}
      </Panel>
    );
  },
);
