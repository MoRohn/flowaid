/**
 * The ⌘K menu's workspace groups (pure, so it is unit tested): things to create, the workspace's
 * workflows, recent runs and templates, settings sections and help. Icons are attached by the
 * component; here every item carries a `to` (an app path), an `href` (a page outside the app) or
 * an `action` the component knows.
 */
import { humanizeId } from "~/runs/humanTasks";
import { HELP } from "./help";

export interface CommandTarget {
  id: string;
  label: string;
  description?: string;
  meta?: string;
  keywords?: string[];
  icon: CommandIcon;
  to?: string;
  href?: string;
  action?: "shortcuts" | "ask";
  /** the question for `action: "ask"` */
  question?: string;
}

export type CommandIcon =
  | "plus"
  | "template"
  | "import"
  | "key"
  | "knowledge"
  | "evaluation"
  | "workflow"
  | "run"
  | "settings"
  | "help"
  | "keyboard"
  | "docs"
  | "bug"
  | "approval"
  | "ask";

export interface CommandGroup {
  id: string;
  heading: string;
  items: CommandTarget[];
}

export interface CommandInput {
  ws: string;
  local: boolean;
  dashboard: boolean;
  can: (scope: string) => boolean;
  features: Readonly<Record<string, boolean>>;
  workflows: readonly { id: string; name: string; latestVersion: number | null }[];
  runs: readonly { id: string; workflowId: string; status: string }[];
  templates: readonly { id: string; name: string; description?: string }[];
  /** What is typed in the menu: a run id (or its first 8+ characters) offers "Go to run". */
  query?: string;
  /** Open human tasks, newest first; the first five are listed. */
  pending?: readonly {
    id: string;
    nodeId: string;
    nodeName?: string;
    workflowId: string;
    runId: string;
  }[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ID_PREFIX = /^[0-9a-f]{8}[0-9a-f-]{0,27}$/i;

/** A full run id, or the start of one (8+ hex characters, as the UI shows them). */
export function runIdQuery(query: string): { kind: "id" | "prefix"; value: string } | null {
  const q = query.trim().toLowerCase();
  if (UUID.test(q)) return { kind: "id", value: q };
  if (ID_PREFIX.test(q)) return { kind: "prefix", value: q };
  return null;
}

const PENDING_SHOWN = 5;

const STATUS: Record<string, string> = {
  waiting_for_human: "waiting for a person",
  timed_out: "timed out",
};

/**
 * "Go to run …" for a typed run id: straight to the run for a full id or for a prefix one recent
 * run matches, otherwise the runs list searched by the prefix.
 */
function goToRun(i: CommandInput, at: (path: string) => string): CommandTarget[] {
  const q = runIdQuery(i.query ?? "");
  if (!q || !i.can("runs:read")) return [];
  const matches = q.kind === "prefix" ? i.runs.filter((r) => r.id.startsWith(q.value)) : [];
  const id = q.kind === "id" ? q.value : matches.length === 1 ? matches[0]?.id : undefined;
  // cmdk filters on keywords: the typed text itself keeps the item visible
  const keywords = ["run", "go to", "id", i.query?.trim() ?? ""];
  return id
    ? [{ id: "goto-run", label: `Go to run ${id}`, icon: "run", keywords, to: at(`runs/${id}`) }]
    : [
        {
          id: "goto-run",
          label: `Find runs starting with ${q.value}`,
          description: "Searches the runs list by id",
          icon: "run",
          keywords,
          to: at(`runs?q=${encodeURIComponent(q.value)}`),
        },
      ];
}

/** "Ask FlowAId" (features.assistant): the typed text as a question, or the empty panel. */
function askItems(i: CommandInput): CommandTarget[] {
  if (!i.features.assistant || !i.can("runs:read")) return [];
  const q = (i.query ?? "").trim();
  const question = q.length >= 3 && !runIdQuery(q) ? q : undefined;
  return [
    {
      id: "ask",
      label: question ? `Ask FlowAId: “${question}”` : "Ask FlowAId…",
      description: "Answers about runs, failures, costs and approvals, with sources",
      icon: "ask",
      // cmdk filters on keywords: the typed text itself keeps the item visible
      keywords: ["ask", "question", "assistant", "why", "what", q],
      action: "ask",
      ...(question ? { question } : {}),
    },
  ];
}

export function commandGroups(i: CommandInput): {
  leading: CommandGroup[];
  trailing: CommandGroup[];
} {
  const at = (path: string) => (path ? `/${i.ws}/${path}` : `/${i.ws}`);
  const write = i.can("workflows:write");
  const create: CommandTarget[] = [
    ...(write
      ? [
          {
            id: "create-workflow",
            label: "New workflow",
            description: "A blank canvas with an input and an output",
            icon: "plus" as const,
            keywords: ["create", "blank", "canvas"],
            to: at("workflows/new"),
          },
          {
            id: "create-from-template",
            label: "New workflow from a template",
            icon: "template" as const,
            keywords: ["create", "example", "starter"],
            to: at("templates"),
          },
          {
            id: "import-workflow",
            label: "Import a workflow",
            description: "A FlowAId definition, or a flow exported from another builder",
            icon: "import" as const,
            keywords: ["upload", "json", "yaml", "export", "migrate"],
            to: at("workflows/new"),
          },
        ]
      : []),
    ...(i.can("credentials:write") || i.can("credentials:read")
      ? [
          {
            id: "add-credential",
            label: "Add a provider key or credential",
            icon: "key" as const,
            keywords: ["api key", "secret", "typesafe", "openai", "anthropic", "credential"],
            to: at("credentials?new=1"),
          },
        ]
      : []),
    ...(i.can("api_keys:manage")
      ? [
          {
            id: "create-api-key",
            label: "Create an API key",
            description: "For scripts, the SDK and the CLI",
            icon: "key" as const,
            keywords: ["token", "sdk", "cli", "curl"],
            to: at("settings?tab=api-keys&new=1"),
          },
        ]
      : []),
    ...(i.features.knowledge
      ? [
          {
            id: "create-knowledge",
            label: "New knowledge source",
            icon: "knowledge" as const,
            keywords: ["rag", "documents", "search", "retrieval"],
            to: at("knowledge?new=1"),
          },
        ]
      : []),
    ...(i.features.evaluations
      ? [
          {
            id: "create-evaluation",
            label: "New evaluation set",
            icon: "evaluation" as const,
            keywords: ["test", "regression", "cases"],
            to: at("evaluations?new=1"),
          },
        ]
      : []),
  ];

  const names = new Map(i.workflows.map((w) => [w.id, w.name]));
  const pending = i.pending ?? [];
  const leading: CommandGroup[] = [
    { id: "goto", heading: "Go to", items: goToRun(i, at) },
    { id: "ask", heading: "Ask", items: askItems(i) },
    {
      id: "pending",
      heading: "Pending approvals",
      items: [
        ...pending.slice(0, PENDING_SHOWN).map((t) => ({
          id: `pending-${t.id}`,
          label: t.nodeName ?? humanizeId(t.nodeId),
          description: `${names.get(t.workflowId) ?? "Workflow"} · run ${t.runId.slice(0, 8)}`,
          meta: "pending",
          icon: "approval" as const,
          keywords: ["approval", "pending", "review", "human task", t.runId],
          to: at(`human-tasks/${t.id}`),
        })),
        ...(pending.length > PENDING_SHOWN
          ? [
              {
                id: "pending-all",
                label: `All pending approvals (${pending.length})`,
                icon: "approval" as const,
                keywords: ["approval", "pending", "inbox", "human tasks"],
                to: at("human-tasks"),
              },
            ]
          : []),
      ],
    },
    { id: "create", heading: "Create", items: create },
    {
      id: "workflows",
      heading: "Workflows",
      items: i.workflows.map((w) => ({
        id: `workflow-${w.id}`,
        label: w.name,
        meta: w.latestVersion === null ? "draft" : `v${w.latestVersion}`,
        icon: "workflow",
        keywords: ["workflow", "open", "builder"],
        to: at(`workflows/${w.id}`),
      })),
    },
    {
      id: "runs",
      heading: "Recent runs",
      items: i.runs.map((r) => ({
        id: `run-${r.id}`,
        label: names.get(r.workflowId) ?? "Run",
        description: `${STATUS[r.status] ?? r.status.replace(/_/g, " ")} · ${r.id.slice(0, 8)}`,
        icon: "run",
        keywords: ["run", "trace", r.id, r.status],
        to: at(`runs/${r.id}`),
      })),
    },
    {
      id: "templates",
      heading: "Templates",
      items: write
        ? i.templates.map((t) => ({
            id: `template-${t.id}`,
            label: t.name,
            ...(t.description ? { description: t.description } : {}),
            meta: "template",
            icon: "template",
            keywords: ["template", "use", "start"],
            to: at(`templates?use=${encodeURIComponent(t.id)}`),
          }))
        : [],
    },
  ];

  const settings: CommandTarget[] = [
    ["workspace", "Workspace settings", true],
    ["members", "Members", !i.local],
    ["api-keys", "API keys", i.can("api_keys:manage")],
    ["environments", "Environments", true],
    ["notifications", "Notification channels", i.features.settings_notifications === true],
    ["audit", "Audit log", i.features.settings_audit === true],
    ["profile", "Profile and password", !i.local],
  ]
    .filter(([, , show]) => show)
    .map(([tab, label]) => ({
      id: `settings-${String(tab)}`,
      label: String(label),
      icon: "settings" as const,
      keywords: ["settings", "configure"],
      to: at(`settings?tab=${String(tab)}`),
    }));
  settings.push(
    {
      id: "integrations-providers",
      label: "Providers and models",
      icon: "settings",
      keywords: ["integrations", "llm", "model", "pricing", "server key"],
      to: at("integrations?tab=providers"),
    },
    {
      id: "integrations-mcp",
      label: "MCP servers",
      icon: "settings",
      keywords: ["integrations", "tools"],
      to: at("integrations?tab=mcp"),
    },
  );

  const help: CommandTarget[] = [
    ...(i.dashboard
      ? [
          {
            id: "help-getting-started",
            label: "Getting started checklist",
            icon: "help" as const,
            keywords: ["onboarding", "setup", "tour", "help"],
            to: `${at("")}?getting-started`,
          },
        ]
      : []),
    {
      id: "help-docs",
      label: "Guides and documentation",
      icon: "docs",
      keywords: ["help", "manual", "docs"],
      href: HELP.gettingStarted,
    },
    {
      id: "help-shortcuts",
      label: "Keyboard shortcuts",
      icon: "keyboard",
      keywords: ["help", "keys", "hotkeys"],
      action: "shortcuts",
    },
    {
      id: "help-issue",
      label: "Report a problem",
      icon: "bug",
      keywords: ["bug", "issue", "feedback", "help"],
      href: HELP.issues,
    },
  ];

  const keep = (g: CommandGroup[]) => g.filter((x) => x.items.length > 0);
  return {
    leading: keep(leading),
    trailing: keep([
      { id: "settings", heading: "Settings", items: settings },
      { id: "help", heading: "Help", items: help },
    ]),
  };
}
