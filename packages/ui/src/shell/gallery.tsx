import { useState, type ReactNode } from "react";
import {
  Bot,
  BookOpen,
  Braces,
  Bug,
  CircleAlert,
  FlaskConical,
  KeyRound,
  LayoutTemplate,
  ListTree,
  Play,
  Plug,
  Plus,
  Rocket,
  ScrollText,
  Settings,
  ShieldCheck,
  Sparkles,
  Terminal,
  TriangleAlert,
  Workflow,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { categoryVar, type NodeCategory } from "@/lib/categories";
import { formatCost, formatMs, formatProbability, formatTokens } from "@/lib/format";
import type { WorkflowVersionView } from "@/types";
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardDescription,
  CardHeader,
  CardTitle,
  CategoryDot,
  FieldRow,
  IconButton,
  Input,
  Kbd,
  Panel,
  SearchInput,
  Select,
  SelectItem,
  Slider,
  StatusChip,
  Textarea,
} from "@/primitives";
import {
  AppShell,
  BottomPanel,
  Breadcrumbs,
  CommandMenu,
  EnvironmentSwitcher,
  KeyboardShortcutsDialog,
  PageHeader,
  ReviewLayout,
  SaveIndicator,
  ShortcutProvider,
  SideNav,
  TopBar,
  UserMenu,
  VersionSwitcher,
  WorkspaceSwitcher,
  useShortcut,
  type BottomPanelTab,
  type BreadcrumbItem,
  type CommandMenuRecent,
  type SaveState,
  type SideNavItem,
  type WorkspaceView,
} from "./index";

// ---------------------------------------------------------------------------
// Gallery scaffolding
// ---------------------------------------------------------------------------

import type { EnvironmentId, EnvironmentView } from "@/types";

/** Environments are workspace data, not an enum (UI.md §3). */
const GALLERY_ENVIRONMENTS: EnvironmentView[] = [
  { id: "env_dev", name: "Development", protected: false },
  { id: "env_stg", name: "Staging", protected: false },
  { id: "env_prod", name: "Production", protected: true },
];

function Section({
  id,
  title,
  caption,
  children,
}: {
  id: string;
  title: string;
  caption?: string;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      className="flex flex-col gap-4 border-t border-border pt-6 first:border-t-0 first:pt-0"
    >
      <header className="flex flex-col gap-1">
        <h2 className="text-eyebrow">{title}</h2>
        {caption ? <p className="max-w-2xl text-xs text-ink-3">{caption}</p> : null}
      </header>
      {children}
    </section>
  );
}

function Frame({
  children,
  className,
  height,
}: {
  children: ReactNode;
  className?: string;
  height: number;
}) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-md border border-border bg-canvas shadow-1",
        className,
      )}
      style={{ height }}
    >
      {children}
    </div>
  );
}

function Caption({ children }: { children: ReactNode }) {
  return <p className="text-2xs text-ink-3">{children}</p>;
}

// ---------------------------------------------------------------------------
// Sample data: support-triage workflow
// ---------------------------------------------------------------------------

const NAV_ITEMS: SideNavItem[] = [
  {
    id: "workflows",
    label: "Workflows",
    icon: <Workflow strokeWidth={1.75} />,
    count: 12,
    shortcut: "g w",
  },
  { id: "agents", label: "Agents", icon: <Bot strokeWidth={1.75} />, count: 3, shortcut: "g a" },
  {
    id: "runs",
    label: "Runs",
    icon: <Play strokeWidth={1.75} />,
    count: 4,
    countTone: "warn",
    shortcut: "g r",
  },
  { id: "templates", label: "Templates", icon: <LayoutTemplate strokeWidth={1.75} /> },
  { id: "integrations", label: "Integrations", icon: <Plug strokeWidth={1.75} /> },
  { id: "knowledge", label: "Knowledge", icon: <BookOpen strokeWidth={1.75} /> },
  { id: "evaluations", label: "Evaluations", icon: <FlaskConical strokeWidth={1.75} />, count: 2 },
  { id: "credentials", label: "Credentials", icon: <KeyRound strokeWidth={1.75} /> },
];
const NAV_SECONDARY: SideNavItem[] = [
  { id: "settings", label: "Settings", icon: <Settings strokeWidth={1.75} />, shortcut: "g s" },
];

const WORKSPACES: WorkspaceView[] = [
  { id: "acme", name: "Acme Support", plan: "Team · 6 members" },
  { id: "acme-labs", name: "Acme Labs", plan: "Free" },
  { id: "personal", name: "Rohn's workspace", plan: "Personal" },
];

const USER = { name: "Rohn Springfield", email: "rohn@acme.support" };

const VERSIONS: WorkflowVersionView[] = [
  {
    id: "v13",
    version: 13,
    status: "draft",
    createdAt: "2026-09-22T08:12:00Z",
    createdBy: "Rohn",
    message: "Raise auto threshold to 0.90",
    nodeCount: 11,
  },
  {
    id: "v12",
    version: 12,
    status: "production",
    createdAt: "2026-09-18T15:40:00Z",
    createdBy: "Mira",
    message: "Add safety guard before reply",
    nodeCount: 10,
  },
  {
    id: "v11",
    version: 11,
    status: "published",
    createdAt: "2026-09-11T10:03:00Z",
    createdBy: "Mira",
    message: "Urgency score → 5 levels",
    nodeCount: 9,
  },
  {
    id: "v10",
    version: 10,
    status: "archived",
    createdAt: "2026-09-02T09:30:00Z",
    createdBy: "Rohn",
    message: "Initial router",
    nodeCount: 8,
  },
];

const CRUMBS: BreadcrumbItem[] = [
  { id: "ws", label: "Acme Support" },
  { id: "workflows", label: "Workflows", href: "#/shell" },
  { id: "wf", label: "Support triage" },
];

const RECENT: CommandMenuRecent[] = [
  {
    kind: "workflow",
    id: "wf_support",
    name: "Support triage",
    meta: "v12 · 10 nodes",
    onSelect: () => undefined,
  },
  {
    kind: "workflow",
    id: "wf_refunds",
    name: "Refund approvals",
    meta: "v4 · 7 nodes",
    onSelect: () => undefined,
  },
  {
    kind: "run",
    id: "run_01j8x2q9",
    workflowName: "Support triage",
    status: "waiting_for_human",
    durationMs: 4210,
    onSelect: () => undefined,
  },
  {
    kind: "run",
    id: "run_01j8x1kf",
    workflowName: "Support triage",
    status: "completed",
    durationMs: 2890,
    onSelect: () => undefined,
  },
];

interface TraceRow {
  at: string;
  name: string;
  kind: string;
  category: NodeCategory;
  durationMs: number;
  status: "completed" | "running" | "waiting_for_human" | "failed";
  distribution?: Array<{ label: string; p: number }>;
  note?: string;
}

const TRACE: TraceRow[] = [
  {
    at: "14:02:11.004",
    name: "Start",
    kind: "flow.start",
    category: "flow",
    durationMs: 2,
    status: "completed",
  },
  {
    at: "14:02:11.010",
    name: "Intent",
    kind: "decision.choice",
    category: "decision",
    durationMs: 412,
    status: "completed",
    distribution: [
      { label: "billing", p: 0.81 },
      { label: "technical", p: 0.12 },
      { label: "account", p: 0.04 },
      { label: "other", p: 0.03 },
    ],
  },
  {
    at: "14:02:11.428",
    name: "Urgency",
    kind: "decision.score",
    category: "decision",
    durationMs: 388,
    status: "completed",
    note: "level 3/5 · confidence 0.74",
  },
  {
    at: "14:02:11.820",
    name: "Escalation",
    kind: "decision.boolean",
    category: "decision",
    durationMs: 301,
    status: "completed",
    note: "false · P(yes) 0.09",
  },
  {
    at: "14:02:12.125",
    name: "Router",
    kind: "flow.router",
    category: "flow",
    durationMs: 1,
    status: "completed",
    note: "→ billing",
  },
  {
    at: "14:02:12.130",
    name: "Fetch invoice",
    kind: "tool.http",
    category: "tool",
    durationMs: 642,
    status: "completed",
    note: "GET /invoices/inv_8841 · 200",
  },
  {
    at: "14:02:12.775",
    name: "Draft reply",
    kind: "generation.text",
    category: "generation",
    durationMs: 1840,
    status: "completed",
    note: "gpt-5-mini · 412 tokens",
  },
  {
    at: "14:02:14.620",
    name: "Safety",
    kind: "safety.guard",
    category: "safety",
    durationMs: 96,
    status: "completed",
    note: "pass · pii none",
  },
  {
    at: "14:02:14.720",
    name: "Confidence gate",
    kind: "decision.gate",
    category: "decision",
    durationMs: 1,
    status: "completed",
    note: "0.74 < auto 0.90 → review",
  },
  {
    at: "14:02:14.722",
    name: "Approval",
    kind: "human.approval",
    category: "human",
    durationMs: 0,
    status: "waiting_for_human",
    note: "assigned to tier-2",
  },
];

const LOGS: Array<{ at: string; level: "info" | "warn" | "debug" | "error"; message: string }> = [
  {
    at: "14:02:11.004",
    level: "info",
    message: "run_01j8x2q9 started · trigger=webhook · env=staging",
  },
  {
    at: "14:02:11.010",
    level: "debug",
    message: "decision.choice Intent → jev-latest (temperature 0)",
  },
  { at: "14:02:11.428", level: "info", message: "Intent = billing (0.81) · 412 ms · $0.00031" },
  { at: "14:02:11.820", level: "info", message: "Urgency = 3 (0.74) · 388 ms" },
  {
    at: "14:02:12.130",
    level: "debug",
    message: "tool.http GET https://api.acme.support/invoices/inv_8841",
  },
  { at: "14:02:12.775", level: "info", message: "tool.http 200 · 642 ms · 3.1 kB" },
  {
    at: "14:02:14.620",
    level: "warn",
    message: "generation.text Draft reply exceeded 1.5 s budget (1.84 s)",
  },
  {
    at: "14:02:14.720",
    level: "info",
    message: "gate: confidence 0.74 below auto 0.90 → secondary review",
  },
  { at: "14:02:14.722", level: "info", message: "human.approval requested · expires in 4 h" },
];

const OUTPUT_JSON = `{
  "intent": { "value": "billing", "confidence": 0.81 },
  "urgency": { "value": 3, "confidence": 0.74, "legend": "high" },
  "escalate": { "value": false, "confidence": 0.91 },
  "invoice": { "id": "inv_8841", "amount": 128.4, "currency": "USD", "status": "overdue" },
  "reply": "Hi Dana, I can see invoice inv_8841 is 12 days overdue…",
  "gate": { "outcome": "review", "threshold": 0.9, "reviewBand": 0.3 }
}`;

const PROBLEMS: Array<{
  severity: "error" | "warning" | "info";
  node: string;
  message: string;
  path?: string;
}> = [
  {
    severity: "error",
    node: "Fetch invoice",
    message: 'Credential "acme-api" is not available in production',
    path: "auth.credentialId",
  },
  {
    severity: "warning",
    node: "Draft reply",
    message: "Latency budget 1.5 s exceeded in 3 of the last 20 runs",
  },
  {
    severity: "warning",
    node: "Confidence gate",
    message: "Review threshold 0.60 is below the calibration floor (0.65)",
    path: "thresholds.review",
  },
  {
    severity: "info",
    node: "Urgency",
    message: "Level legend has no label for index 4",
    path: "criteria.legend[4]",
  },
];

// ---------------------------------------------------------------------------
// Mock content for the slots
// ---------------------------------------------------------------------------

function ProbabilityRuler({ distribution }: { distribution: Array<{ label: string; p: number }> }) {
  const ramp = ["bg-p-1", "bg-p-2", "bg-p-3", "bg-p-4"];
  return (
    <div className="flex flex-col gap-1">
      <div className="flex h-1.5 w-full gap-0.5">
        {distribution.map((d, i) => (
          <span
            key={d.label}
            className={cn("rounded-[2px]", ramp[Math.min(i, ramp.length - 1)])}
            style={{ flexBasis: `${d.p * 100}%` }}
          />
        ))}
      </div>
      <div className="flex gap-0.5 font-mono text-2xs text-ink-3 tabular">
        {distribution.map((d, i) => (
          <span
            key={d.label}
            className={cn("truncate", i === 0 && "text-accent-text")}
            style={{ flexBasis: `${d.p * 100}%` }}
          >
            {d.p >= 0.1 ? `${d.label} ${formatProbability(d.p)}` : null}
          </span>
        ))}
      </div>
    </div>
  );
}

function TraceTab() {
  return (
    <ul className="flex flex-col">
      {TRACE.map((row) => (
        <li key={row.at} className="border-b border-border last:border-b-0">
          <div className="flex h-[30px] items-center gap-2.5 px-3 text-xs">
            <span className="w-[92px] shrink-0 font-mono text-2xs text-ink-3 tabular">
              {row.at}
            </span>
            <CategoryDot category={row.category} />
            <span className="w-32 shrink-0 truncate font-medium text-ink">{row.name}</span>
            <span className="w-32 shrink-0 truncate font-mono text-2xs text-ink-3">{row.kind}</span>
            <span className="min-w-0 flex-1 truncate text-ink-2">{row.note}</span>
            <StatusChip status={row.status} size="sm" compact={row.status === "completed"} />
            <span className="w-14 shrink-0 text-right font-mono text-2xs text-ink-3 tabular">
              {formatMs(row.durationMs)}
            </span>
          </div>
          {row.distribution ? (
            <div className="px-3 pb-2 pl-[136px]">
              <ProbabilityRuler distribution={row.distribution} />
            </div>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function LogsTab() {
  const tone: Record<(typeof LOGS)[number]["level"], string> = {
    debug: "text-ink-3",
    info: "text-ink-2",
    warn: "text-warn-text",
    error: "text-danger-text",
  };
  return (
    <pre className="m-0 p-3 font-mono text-2xs leading-[18px] text-ink-2">
      {LOGS.map((l) => (
        <div key={l.at + l.message} className="flex gap-3">
          <span className="text-ink-3 tabular">{l.at}</span>
          <span className={cn("w-10 uppercase", tone[l.level])}>{l.level}</span>
          <span className={cn("min-w-0 flex-1 whitespace-pre-wrap", tone[l.level])}>
            {l.message}
          </span>
        </div>
      ))}
    </pre>
  );
}

function OutputTab() {
  return (
    <pre className="m-0 whitespace-pre-wrap p-3 font-mono text-2xs leading-[18px] text-ink-2">
      {OUTPUT_JSON}
    </pre>
  );
}

function ProblemsTab() {
  const icon = {
    error: (
      <CircleAlert className="size-3.5 text-danger-text" strokeWidth={1.75} aria-hidden="true" />
    ),
    warning: (
      <TriangleAlert className="size-3.5 text-warn-text" strokeWidth={1.75} aria-hidden="true" />
    ),
    info: <CircleAlert className="size-3.5 text-info-text" strokeWidth={1.75} aria-hidden="true" />,
  };
  return (
    <ul className="flex flex-col">
      {PROBLEMS.map((p) => (
        <li
          key={p.node + p.message}
          className="flex h-[30px] items-center gap-2.5 border-b border-border px-3 text-xs last:border-b-0"
        >
          {icon[p.severity]}
          <span className="w-28 shrink-0 truncate font-medium text-ink">{p.node}</span>
          <span className="min-w-0 flex-1 truncate text-ink-2">{p.message}</span>
          {p.path ? <span className="shrink-0 font-mono text-2xs text-ink-3">{p.path}</span> : null}
        </li>
      ))}
    </ul>
  );
}

function RunTab() {
  const stats: Array<[string, string]> = [
    ["run", "run_01j8x2q9"],
    ["trigger", "webhook"],
    ["duration", formatMs(4210)],
    ["cost", formatCost(0.00187)],
    ["tokens", `${formatTokens(1462)} in · ${formatTokens(412)} out`],
    ["decisions", "3 · min confidence 0.74"],
  ];
  return (
    <div className="flex flex-col gap-3 p-3">
      <div className="flex items-center gap-2">
        <StatusChip status="waiting_for_human" meta="4 h left" />
        <span className="text-xs text-ink-2">Waiting at</span>
        <span className="text-xs font-medium text-ink">Approval</span>
        <span className="font-mono text-2xs text-ink-3">human.approval</span>
        <Button size="sm" variant="secondary" className="ml-auto">
          Open approval
        </Button>
      </div>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-3">
        {stats.map(([k, v]) => (
          <div
            key={k}
            className="flex items-baseline justify-between gap-3 border-b border-border py-1"
          >
            <dt className="text-eyebrow">{k}</dt>
            <dd className="m-0 truncate font-mono text-2xs text-ink tabular">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function bottomTabs(): BottomPanelTab[] {
  return [
    { id: "run", label: "Run", icon: <Play strokeWidth={1.75} />, content: <RunTab /> },
    {
      id: "trace",
      label: "Trace",
      icon: <ListTree strokeWidth={1.75} />,
      count: TRACE.length,
      content: <TraceTab />,
    },
    {
      id: "logs",
      label: "Logs",
      icon: <Terminal strokeWidth={1.75} />,
      count: LOGS.length,
      content: <LogsTab />,
    },
    { id: "output", label: "Output", icon: <Braces strokeWidth={1.75} />, content: <OutputTab /> },
    {
      id: "problems",
      label: "Problems",
      icon: <Bug strokeWidth={1.75} />,
      count: PROBLEMS.length,
      countTone: "danger",
      content: <ProblemsTab />,
    },
  ];
}

function MiniNode({
  name,
  kind,
  category,
  x,
  y,
  status,
  selected,
  children,
}: {
  name: string;
  kind: string;
  category: NodeCategory;
  x: number;
  y: number;
  status?: "running" | "waiting" | "failed";
  selected?: boolean;
  children?: ReactNode;
}) {
  return (
    <div
      className={cn(
        "absolute w-[184px] rounded-md border bg-surface shadow-1",
        selected
          ? "border-accent shadow-[0_0_0_3px_var(--accent-soft),var(--shadow-1)]"
          : "border-border",
        status === "running" && "border-info",
        status === "waiting" && "border-cat-human",
        status === "failed" && "border-danger",
      )}
      style={{ left: x, top: y }}
    >
      <div className="flex items-center gap-2 px-2.5 pt-2">
        <span className="size-2 rounded-full" style={{ backgroundColor: categoryVar(category) }} />
        <span className="text-xs font-semibold tracking-tight text-ink">{name}</span>
        <span className="ml-auto font-mono text-2xs text-ink-3">{kind}</span>
      </div>
      <div className="px-2.5 pb-2 pt-1">{children}</div>
    </div>
  );
}

function CanvasMock() {
  return (
    <div className="canvas-grid relative h-full w-full overflow-hidden">
      <MiniNode name="Intent" kind="choice" category="decision" x={24} y={32} selected>
        <ProbabilityRuler
          distribution={[
            { label: "billing", p: 0.81 },
            { label: "technical", p: 0.12 },
            { label: "account", p: 0.04 },
            { label: "other", p: 0.03 },
          ]}
        />
      </MiniNode>
      <MiniNode name="Urgency" kind="score" category="decision" x={24} y={160}>
        <span className="font-mono text-2xs text-ink-3">level 3/5 · 0.74</span>
      </MiniNode>
      <MiniNode name="Router" kind="router" category="flow" x={232} y={96}>
        <span className="font-mono text-2xs text-ink-3">billing · technical · account</span>
      </MiniNode>
      <MiniNode name="Fetch invoice" kind="http" category="tool" x={440} y={32}>
        <span className="font-mono text-2xs text-ink-3">GET /invoices/:id · 642 ms</span>
      </MiniNode>
      <MiniNode name="Draft reply" kind="text" category="generation" x={440} y={160}>
        <span className="font-mono text-2xs text-ink-3">gpt-5-mini · 1.84 s</span>
      </MiniNode>
      <MiniNode name="Approval" kind="approval" category="human" x={440} y={288} status="waiting">
        <span className="font-mono text-2xs text-cat-human">waiting · tier-2</span>
      </MiniNode>
      <svg className="pointer-events-none absolute inset-0 size-full" aria-hidden="true">
        <g fill="none" stroke="var(--border-strong)" strokeWidth="1.5">
          <path d="M208 76 C 220 76, 220 128, 232 128" />
          <path d="M208 204 C 220 204, 220 128, 232 128" />
          <path d="M416 128 C 428 128, 428 76, 440 76" />
          <path d="M416 128 C 428 128, 428 204, 440 204" />
          <path d="M532 248 L 532 288" />
        </g>
      </svg>
      <div className="absolute bottom-3 left-3 flex items-center gap-2 rounded-sm border border-border bg-surface px-2 py-1 text-2xs text-ink-3 shadow-1">
        <Sparkles className="size-3.5 text-accent" strokeWidth={1.75} aria-hidden="true" />
        Canvas placeholder · the canvas group renders the real graph here
      </div>
      <div className="absolute right-3 top-3 flex items-center gap-1 rounded-sm border border-border bg-surface px-2 py-1 font-mono text-2xs text-ink-3 shadow-1">
        100% · 11 nodes
      </div>
    </div>
  );
}

function InspectorMock() {
  return (
    <Panel
      flush
      title="Intent"
      meta="decision.choice"
      icon={<CategoryDot category="decision" />}
      className="h-full"
      bodyClassName="flex flex-col gap-3"
    >
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Last result</CardTitle>
            <CardDescription>run_01j8x2q9 · 412 ms · jev-latest</CardDescription>
          </div>
          <Badge tone="accent" mono>
            0.81
          </Badge>
        </CardHeader>
        <CardBody>
          <ProbabilityRuler
            distribution={[
              { label: "billing", p: 0.81 },
              { label: "technical", p: 0.12 },
              { label: "account", p: 0.04 },
              { label: "other", p: 0.03 },
            ]}
          />
        </CardBody>
      </Card>
      <FieldRow label="Name" htmlFor="insp-name">
        <Input id="insp-name" defaultValue="Intent" />
      </FieldRow>
      <FieldRow
        label="Question"
        htmlFor="insp-q"
        hint="Shown to the decision model with the ticket text."
      >
        <Textarea id="insp-q" defaultValue="What is the customer asking about?" minRows={2} />
      </FieldRow>
      <FieldRow label="Model" htmlFor="insp-model">
        <Select id="insp-model" defaultValue="jev-latest" mono aria-label="Model">
          <SelectItem value="jev-latest">jev-latest</SelectItem>
          <SelectItem value="jev-mini">jev-mini</SelectItem>
        </Select>
      </FieldRow>
      <FieldRow
        label="Thresholds"
        hint="Below review → human · between → secondary review · above auto → automatic"
      >
        <Slider
          defaultValue={[0.6, 0.9]}
          min={0}
          max={1}
          step={0.01}
          showValue
          aria-label="Confidence thresholds"
        />
      </FieldRow>
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Full builder mock
// ---------------------------------------------------------------------------

function BuilderMock({
  storageKey,
  defaultLayout,
  forceCompact,
  compactBreakpoint,
  shortcuts = true,
  saveState: initialSave = "saved",
}: {
  storageKey: string | null;
  defaultLayout?: Parameters<typeof AppShell>[0]["defaultLayout"];
  forceCompact?: boolean;
  compactBreakpoint?: number;
  shortcuts?: boolean;
  saveState?: SaveState;
}) {
  const [env, setEnv] = useState<EnvironmentId>("env_stg");
  const [active, setActive] = useState("workflows");
  const [workspace, setWorkspace] = useState("acme");
  const [saveState, setSaveState] = useState<SaveState>(initialSave);
  const [name, setName] = useState("Support triage");
  const [follow, setFollow] = useState(true);
  const [running, setRunning] = useState(false);

  const crumbs = CRUMBS.map((c) => (c.id === "wf" ? { ...c, label: name } : c));

  return (
    <AppShell
      storageKey={storageKey}
      defaultLayout={defaultLayout}
      forceCompact={forceCompact}
      compactBreakpoint={compactBreakpoint}
      shortcuts={shortcuts}
      topbar={
        <TopBar
          breadcrumbs={crumbs}
          onRename={(n) => {
            setName(n);
            setSaveState("unsaved");
          }}
          environments={GALLERY_ENVIRONMENTS}
          environment={env}
          onEnvironmentChange={setEnv}
          versions={VERSIONS}
          currentVersionId="v13"
          versionActions={{
            onOpen: () => undefined,
            onCompare: () => undefined,
            onRollback: () => undefined,
            onViewAll: () => undefined,
          }}
          saveState={saveState}
          savedAt="2026-09-22T08:12:00Z"
          onRun={() => {
            setRunning(true);
            window.setTimeout(() => setRunning(false), 1200);
          }}
          running={running}
          onPublish={() => setSaveState("saved")}
          onDuplicate={() => undefined}
          onExportJson={() => undefined}
          onImport={() => undefined}
          onDelete={() => undefined}
          trailing={
            <UserMenu
              user={USER}
              onProfile={() => undefined}
              onPreferences={() => undefined}
              onShortcuts={() => undefined}
              onSignOut={() => undefined}
            />
          }
        />
      }
      nav={
        <SideNav
          items={NAV_ITEMS}
          secondaryItems={NAV_SECONDARY}
          activeId={active}
          onNavigate={setActive}
          workspace={{
            workspaces: WORKSPACES,
            currentId: workspace,
            onChange: setWorkspace,
            onCreate: () => undefined,
            onSettings: () => undefined,
          }}
          header={(collapsed) =>
            collapsed ? (
              <IconButton label="New workflow" variant="secondary" tooltipSide="right">
                <Plus strokeWidth={1.75} />
              </IconButton>
            ) : (
              <Button
                variant="secondary"
                className="w-full justify-start"
                leadingIcon={<Plus strokeWidth={1.75} />}
              >
                New workflow
              </Button>
            )
          }
        />
      }
      inspector={<InspectorMock />}
      bottomPanel={
        <BottomPanel
          tabs={bottomTabs()}
          defaultValue="trace"
          follow={follow}
          onFollowChange={setFollow}
          onClear={() => undefined}
        />
      }
      commandMenu={
        <CommandMenu
          pages={NAV_ITEMS.map((i) => ({
            id: i.id,
            label: i.label,
            icon: i.icon,
            shortcut: i.shortcut,
            onSelect: () => setActive(i.id),
          }))}
          actions={[
            {
              id: "run",
              label: "Run with test input",
              icon: <Play strokeWidth={1.75} />,
              shortcut: "mod+enter",
              onSelect: () => undefined,
            },
            {
              id: "publish",
              label: "Publish v13",
              description: "Replaces v12 in production",
              icon: <Rocket strokeWidth={1.75} />,
              onSelect: () => undefined,
            },
            {
              id: "validate",
              label: "Validate workflow",
              icon: <ShieldCheck strokeWidth={1.75} />,
              onSelect: () => undefined,
            },
            {
              id: "add-node",
              label: "Add node",
              icon: <Plus strokeWidth={1.75} />,
              shortcut: "shift+a",
              onSelect: () => undefined,
            },
          ]}
          recent={RECENT}
          onAskAi={() => undefined}
        />
      }
    >
      <CanvasMock />
    </AppShell>
  );
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

function AppShellSection() {
  return (
    <Section
      id="app-shell"
      title="App shell"
      caption="TopBar 44px · SideNav 208px · content · inspector 320px (drag the 1px handle) · bottom panel 280px. mod+B, mod+J, mod+I toggle the panels, mod+K opens the command menu and ? lists every shortcut. Layout persists in localStorage."
    >
      <Frame height={720}>
        <BuilderMock storageKey="flowaid:shell:gallery" />
      </Frame>
    </Section>
  );
}

function CollapsedSection() {
  return (
    <Section
      id="collapsed"
      title="Collapsed states"
      caption="Top: 48px icon rail with tooltips, inspector and bottom panel hidden, environment moved into the overflow menu. Below: under 900px the bar collapses to icons, the nav becomes a drawer behind the menu button and the inspector opens as a sheet."
    >
      <div className="flex flex-col gap-4">
        <Frame height={420}>
          <BuilderMock
            storageKey={null}
            shortcuts={false}
            defaultLayout={{ navCollapsed: true, inspectorOpen: false, bottomOpen: false }}
            saveState="unsaved"
          />
        </Frame>
        <div className="flex flex-wrap items-start gap-4">
          <Frame height={520} className="w-[400px]">
            <BuilderMock storageKey={null} shortcuts={false} forceCompact saveState="saving" />
          </Frame>
          <Caption>
            Tap the menu button for the nav drawer and the inspector icon for the sheet; both are
            modal overlays, so they are not captured in a frame.
          </Caption>
        </div>
      </div>
    </Section>
  );
}

function TopBarSection() {
  const [openedAt] = useState(() => Date.now());
  const [env, setEnv] = useState<EnvironmentId>("env_dev");
  const states: SaveState[] = ["saved", "saving", "unsaved", "error"];
  return (
    <Section
      id="topbar"
      title="Top bar"
      caption="Standalone bars for each save state. The last crumb renames inline (double-click, Enter or the pencil)."
    >
      <div className="flex flex-col gap-3">
        {states.map((s) => (
          <div key={s} className="overflow-hidden rounded-md border border-border shadow-1">
            <TopBar
              breadcrumbs={CRUMBS}
              onRename={() => undefined}
              environments={GALLERY_ENVIRONMENTS}
              environment={env}
              onEnvironmentChange={setEnv}
              versions={VERSIONS}
              currentVersionId={s === "saved" ? "v12" : "v13"}
              saveState={s}
              savedAt={new Date(openedAt - 42_000).toISOString()}
              saveError={s === "error" ? "Network unreachable" : undefined}
              onRun={() => undefined}
              onPublish={() => undefined}
              publishDisabled={s === "error"}
              onDuplicate={() => undefined}
              onExportJson={() => undefined}
              onImport={() => undefined}
              onDelete={() => undefined}
              layoutToggles={false}
              trailing={<UserMenu user={USER} onSignOut={() => undefined} />}
            />
          </div>
        ))}
      </div>
    </Section>
  );
}

function SideNavSection() {
  const [active, setActive] = useState("runs");
  const [collapsed, setCollapsed] = useState(false);
  return (
    <Section
      id="sidenav"
      title="Side nav"
      caption="Arrow keys move between items, Home/End jump. Counts read as mono; warn-toned counts flag pending approvals. The collapsed rail keeps counts as dots and names in tooltips."
    >
      <div className="flex flex-wrap gap-4">
        <Frame height={440} className="w-52">
          <SideNav
            items={NAV_ITEMS}
            secondaryItems={NAV_SECONDARY}
            activeId={active}
            onNavigate={setActive}
            collapsed={collapsed}
            onCollapsedChange={setCollapsed}
            workspace={{
              workspaces: WORKSPACES,
              currentId: "acme",
              onChange: () => undefined,
              onCreate: () => undefined,
            }}
          />
        </Frame>
        <Frame height={440} className="w-12">
          <SideNav
            items={NAV_ITEMS}
            secondaryItems={NAV_SECONDARY}
            activeId={active}
            onNavigate={setActive}
            collapsed
            workspace={{ workspaces: WORKSPACES, currentId: "acme", onChange: () => undefined }}
          />
        </Frame>
      </div>
    </Section>
  );
}

function BottomPanelSection() {
  const [tab, setTab] = useState("problems");
  const [follow, setFollow] = useState(false);
  const [expanded, setExpanded] = useState(false);
  return (
    <Section
      id="bottom-panel"
      title="Bottom panel"
      caption="Tabs with counts (Problems in red), follow / clear / expand / close on the right. Content slots are per tab."
    >
      <Frame height={expanded ? 420 : 240}>
        <BottomPanel
          tabs={bottomTabs()}
          value={tab}
          onValueChange={setTab}
          follow={follow}
          onFollowChange={setFollow}
          onClear={() => undefined}
          expanded={expanded}
          onExpandedChange={setExpanded}
          onClose={() => undefined}
        />
      </Frame>
    </Section>
  );
}

function GalleryShortcuts() {
  useShortcut("g w", () => undefined, { description: "Go to workflows", group: "Navigate" });
  useShortcut("g r", () => undefined, { description: "Go to runs", group: "Navigate" });
  useShortcut("g s", () => undefined, { description: "Go to settings", group: "Navigate" });
  useShortcut("mod+enter", () => undefined, {
    description: "Run with test input",
    group: "Workflow",
    global: true,
  });
  useShortcut("mod+shift+p", () => undefined, { description: "Publish", group: "Workflow" });
  useShortcut("shift+a", () => undefined, { description: "Add node", group: "Canvas" });
  useShortcut(["delete", "backspace"], () => undefined, {
    description: "Delete selection",
    group: "Canvas",
  });
  return null;
}

function OverlaysSection() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [env, setEnv] = useState<EnvironmentId>("env_stg");
  return (
    <Section
      id="overlays"
      title="Command menu, shortcuts, confirm"
      caption="Modal states. The command menu groups Navigate, Workflow, Recent and Theme and offers the typed text to the AI builder. The shortcuts dialog lists whatever is registered. Switching to production asks first."
    >
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={() => setMenuOpen(true)} trailingIcon={<Kbd size="sm">⌘K</Kbd>}>
          Open command menu
        </Button>
        <Button onClick={() => setShortcutsOpen(true)} trailingIcon={<Kbd size="sm">?</Kbd>}>
          Keyboard shortcuts
        </Button>
        <EnvironmentSwitcher
          environments={GALLERY_ENVIRONMENTS}
          value={env}
          onChange={setEnv}
          protectedNotice="Support triage v12 handles ~1,300 tickets a day in production."
        />
        <Caption>Select Production (a protected environment) to see the confirm step.</Caption>
      </div>
      <CommandMenu
        open={menuOpen}
        onOpenChange={setMenuOpen}
        pages={NAV_ITEMS.slice(0, 4).map((i) => ({
          id: i.id,
          label: i.label,
          icon: i.icon,
          shortcut: i.shortcut,
          onSelect: () => undefined,
        }))}
        actions={[
          {
            id: "run",
            label: "Run with test input",
            icon: <Play strokeWidth={1.75} />,
            shortcut: "mod+enter",
            onSelect: () => undefined,
          },
          {
            id: "publish",
            label: "Publish v13",
            description: "Replaces v12 in production",
            icon: <Rocket strokeWidth={1.75} />,
            onSelect: () => undefined,
          },
          {
            id: "validate",
            label: "Validate workflow",
            icon: <ShieldCheck strokeWidth={1.75} />,
            onSelect: () => undefined,
          },
          {
            id: "add-node",
            label: "Add node",
            icon: <Plus strokeWidth={1.75} />,
            shortcut: "shift+a",
            onSelect: () => undefined,
          },
        ]}
        recent={RECENT}
        onAskAi={() => undefined}
      />
      <KeyboardShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
    </Section>
  );
}

function PiecesSection() {
  const [openedAt] = useState(() => Date.now());
  const [env, setEnv] = useState<EnvironmentId>("env_dev");
  const [name, setName] = useState("Support triage");
  return (
    <Section
      id="pieces"
      title="Environment, version, save state, breadcrumbs"
      caption="The small top-bar parts on their own."
    >
      <div className="grid grid-cols-1 gap-x-8 gap-y-5 md:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Caption>EnvironmentSwitcher · md and sm/short</Caption>
          <div className="flex flex-wrap items-center gap-3">
            <EnvironmentSwitcher
              environments={GALLERY_ENVIRONMENTS}
              value={env}
              onChange={setEnv}
              confirmProtected={false}
            />
            <EnvironmentSwitcher
              environments={GALLERY_ENVIRONMENTS}
              value={env}
              onChange={setEnv}
              confirmProtected={false}
              size="sm"
              short
            />
            <EnvironmentSwitcher
              environments={GALLERY_ENVIRONMENTS}
              value="env_prod"
              onChange={() => undefined}
              disabled
            />
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <Caption>VersionSwitcher · draft, production, published, none</Caption>
          <div className="flex flex-wrap items-center gap-3">
            <VersionSwitcher
              versions={VERSIONS}
              currentId="v13"
              onOpen={() => undefined}
              onCompare={() => undefined}
              onRollback={() => undefined}
              onViewAll={() => undefined}
            />
            <VersionSwitcher versions={VERSIONS} currentId="v12" onOpen={() => undefined} />
            <VersionSwitcher versions={VERSIONS} currentId="v11" onOpen={() => undefined} />
            <VersionSwitcher versions={[]} />
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <Caption>SaveIndicator · every state, plus compact</Caption>
          <div className="flex flex-wrap items-center gap-3">
            <SaveIndicator state="saved" savedAt={new Date(openedAt - 90_000).toISOString()} />
            <SaveIndicator state="saving" />
            <SaveIndicator state="unsaved" />
            <SaveIndicator state="error" error="409 · someone else published v13" />
            <SaveIndicator state="saved" compact />
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <Caption>Breadcrumbs · rename on the last crumb ({name})</Caption>
          <div className="flex flex-wrap items-center gap-3">
            <Breadcrumbs
              items={CRUMBS.map((c) => (c.id === "wf" ? { ...c, label: name } : c))}
              onRename={setName}
              validateName={(n) => (n.length > 48 ? "Keep it under 48 characters" : undefined)}
            />
          </div>
        </div>
      </div>
    </Section>
  );
}

function PageHeaderSection() {
  const [tab, setTab] = useState("all");
  return (
    <Section
      id="page-header"
      title="Page header"
      caption="List page: title, description, actions, tabs with counts and a search slot."
    >
      <Frame height={132} className="bg-canvas">
        <PageHeader
          title="Runs"
          description="Every execution of Support triage across environments. Waiting runs need a reviewer."
          actions={
            <>
              <Button>Export CSV</Button>
              <Button variant="primary" leadingIcon={<Play strokeWidth={1.75} />}>
                New run
              </Button>
            </>
          }
          tabs={[
            { id: "all", label: "All", count: 1284 },
            { id: "waiting", label: "Waiting", count: 4 },
            { id: "failed", label: "Failed", count: 17 },
            { id: "evaluations", label: "Evaluations", count: 2 },
          ]}
          tab={tab}
          onTabChange={setTab}
          search={
            <SearchInput
              placeholder="Search runs"
              shortcut="/"
              className="w-56"
              aria-label="Search runs"
            />
          }
        />
      </Frame>
      <Frame height={92} className="bg-canvas">
        <PageHeader
          eyebrow="workflow · wf_support"
          title="Support triage"
          badge={<StatusChip status="running" label="3 running" size="sm" />}
          onBack={() => undefined}
          actions={
            <Button variant="primary" leadingIcon={<Rocket strokeWidth={1.75} />}>
              Publish
            </Button>
          }
        />
      </Frame>
    </Section>
  );
}

function MenusSection() {
  const [ws, setWs] = useState("acme");
  return (
    <Section
      id="menus"
      title="Workspace and user menus"
      caption="Footer workspace switcher (expanded and rail) and the account menu."
    >
      <div className="flex flex-wrap items-center gap-6">
        <div className="w-52 rounded-md border border-border bg-surface p-1.5 shadow-1">
          <WorkspaceSwitcher
            workspaces={WORKSPACES}
            currentId={ws}
            onChange={setWs}
            onCreate={() => undefined}
            onSettings={() => undefined}
          />
        </div>
        <div className="rounded-md border border-border bg-surface p-1.5 shadow-1">
          <WorkspaceSwitcher workspaces={WORKSPACES} currentId={ws} onChange={setWs} collapsed />
        </div>
        <UserMenu
          user={USER}
          onProfile={() => undefined}
          onPreferences={() => undefined}
          onShortcuts={() => undefined}
          onSignOut={() => undefined}
        />
        <UserMenu
          user={{ name: "Mira Okafor", email: "mira@acme.support" }}
          size="lg"
          onSignOut={() => undefined}
        />
      </div>
    </Section>
  );
}

function ReviewLayoutSection() {
  return (
    <Section
      id="review"
      title="Review layout"
      caption="External reviewer chrome: mark, title, one 640px column, footer. The human group places its ApprovalCard inside."
    >
      <Frame height={460}>
        <ReviewLayout
          title="Approve reply · Support triage"
          meta="expires in 3 h 48 m"
          actions={<StatusChip status="waiting_for_human" size="sm" />}
        >
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Reply to Dana Whitfield</CardTitle>
                <CardDescription>
                  Intent billing (0.81) · urgency 3/5 (0.74) · confidence below auto threshold 0.90
                </CardDescription>
              </div>
              <Badge tone="warn" dot>
                Review
              </Badge>
            </CardHeader>
            <CardBody className="flex flex-col gap-3">
              <ProbabilityRuler
                distribution={[
                  { label: "billing", p: 0.81 },
                  { label: "technical", p: 0.12 },
                  { label: "account", p: 0.04 },
                  { label: "other", p: 0.03 },
                ]}
              />
              <p className="text-sm text-ink-2">
                Hi Dana, I can see invoice inv_8841 for $128.40 is 12 days overdue. I have extended
                the due date by 7 days and removed the late fee. You can pay from the link below.
              </p>
              <div className="flex items-center gap-2">
                <Button variant="secondary">Edit</Button>
                <Button variant="danger">Reject</Button>
                <Button variant="primary" className="ml-auto">
                  Approve and send
                </Button>
              </div>
            </CardBody>
          </Card>
          <p className="flex items-center gap-1.5 text-2xs text-ink-3">
            <ScrollText className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
            Your decision is recorded on run_01j8x2q9 with your name and timestamp.
          </p>
        </ReviewLayout>
      </Frame>
    </Section>
  );
}

export default function ShellGallery() {
  return (
    <ShortcutProvider>
      <GalleryShortcuts />
      <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-10 p-6 sm:p-8">
        <header className="flex flex-col gap-1">
          <h1 className="text-lg font-semibold tracking-tight">Shell</h1>
          <p className="max-w-2xl text-sm text-ink-2">
            Application chrome: the builder layout, top bar, navigation, bottom panel, command menu,
            keyboard shortcuts and the reviewer layout.
          </p>
        </header>
        <AppShellSection />
        <CollapsedSection />
        <TopBarSection />
        <SideNavSection />
        <BottomPanelSection />
        <OverlaysSection />
        <PiecesSection />
        <PageHeaderSection />
        <MenusSection />
        <ReviewLayoutSection />
      </div>
    </ShortcutProvider>
  );
}
