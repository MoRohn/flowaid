/**
 * The ⌘K menu's workspace groups (pure, so it is unit tested): things to create, the workspace's
 * workflows, recent runs and templates, settings sections and help. Icons are attached by the
 * component; here every item carries a `to` (an app path), an `href` (a page outside the app) or
 * an `action` the component knows.
 */
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
  action?: "shortcuts";
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
  | "bug";

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
}

const STATUS: Record<string, string> = {
  waiting_for_human: "waiting for a person",
  timed_out: "timed out",
};

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
            to: at("credentials"),
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
            to: at("settings?tab=api-keys"),
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
            to: at("knowledge"),
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
            to: at("evaluations"),
          },
        ]
      : []),
  ];

  const names = new Map(i.workflows.map((w) => [w.id, w.name]));
  const leading: CommandGroup[] = [
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
