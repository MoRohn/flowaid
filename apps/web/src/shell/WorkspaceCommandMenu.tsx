"use client";
/**
 * The ⌘K menu with the workspace in it: go to a run by id, pending approvals, create actions,
 * workflows, recent runs, templates, settings and help, next to the navigation and the page's own
 * commands. The lists load only while the menu is open (pending approvals come from the frame).
 */
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useMemo, useState, type ReactNode } from "react";
import {
  BookOpen,
  Bug,
  CheckSquare,
  CircleHelp,
  FileInput,
  FlaskConical,
  KeyRound,
  Keyboard,
  LayoutTemplate,
  Library,
  MessageSquareText,
  Play,
  Plus,
  Settings,
  Workflow,
} from "lucide-react";
import {
  CommandMenu,
  useAppShellOptional,
  type CommandMenuAction,
  type CommandMenuPage,
} from "@flowaid/ui/shell";
import { get } from "~/api/client";
import type { HumanTask, Page } from "~/api/types";
import { useSession } from "~/session";
import { commandGroups, type CommandIcon } from "./commandGroups";

const ICON: Record<CommandIcon, ReactNode> = {
  plus: <Plus strokeWidth={1.75} />,
  template: <LayoutTemplate strokeWidth={1.75} />,
  import: <FileInput strokeWidth={1.75} />,
  key: <KeyRound strokeWidth={1.75} />,
  knowledge: <Library strokeWidth={1.75} />,
  evaluation: <FlaskConical strokeWidth={1.75} />,
  workflow: <Workflow strokeWidth={1.75} />,
  run: <Play strokeWidth={1.75} />,
  settings: <Settings strokeWidth={1.75} />,
  help: <CircleHelp strokeWidth={1.75} />,
  keyboard: <Keyboard strokeWidth={1.75} />,
  docs: <BookOpen strokeWidth={1.75} />,
  bug: <Bug strokeWidth={1.75} />,
  approval: <CheckSquare strokeWidth={1.75} />,
  ask: <MessageSquareText strokeWidth={1.75} />,
};

export function WorkspaceCommandMenu({
  pages,
  actions,
  pending = [],
  onAsk,
}: {
  pages: CommandMenuPage[];
  actions: CommandMenuAction[];
  /** Open human tasks (the frame already polls them for the nav badge). */
  pending?: readonly HumanTask[];
  /** opens Ask FlowAId, asking the question when there is one */
  onAsk?: (question?: string) => void;
}) {
  const s = useSession();
  const router = useRouter();
  const shell = useAppShellOptional();
  const open = shell?.commandOpen ?? false;
  const [query, setQuery] = useState("");
  const workflows = useQuery({
    queryKey: ["command", "workflows", s.ws],
    queryFn: () =>
      get<Page<{ id: string; name: string; latestVersion: number | null }>>(
        "/v1/workflows?limit=100",
      ),
    enabled: open && s.can("workflows:read"),
    staleTime: 30_000,
  });
  const runs = useQuery({
    queryKey: ["command", "runs", s.ws],
    queryFn: () =>
      get<Page<{ id: string; workflowId: string; status: string }>>("/v1/runs?limit=8"),
    enabled: open && s.can("runs:read"),
    staleTime: 15_000,
  });
  const templates = useQuery({
    queryKey: ["command", "templates", s.ws],
    queryFn: () => get<{ id: string; name: string; description?: string }[]>("/v1/templates"),
    enabled: open && s.can("workflows:write"),
    staleTime: 5 * 60_000,
  });

  const groups = useMemo(() => {
    const built = commandGroups({
      ws: s.ws,
      local: s.local,
      dashboard: s.features.dashboard === true,
      can: (scope) => s.can(scope),
      features: s.features,
      workflows: workflows.data?.items ?? [],
      runs: runs.data?.items ?? [],
      templates: templates.data ?? [],
      query,
      pending,
    });
    const view = (g: (typeof built.leading)[number]) => ({
      id: g.id,
      heading: g.heading,
      ...(g.fallback ? { fallback: true } : {}),
      items: g.items.map((t) => ({
        id: t.id,
        label: t.label,
        ...(t.description ? { description: t.description } : {}),
        ...(t.meta ? { meta: t.meta } : {}),
        ...(t.keywords ? { keywords: t.keywords } : {}),
        icon: ICON[t.icon],
        onSelect: () => {
          if (t.to) router.push(t.to);
          else if (t.href) window.open(t.href, "_blank", "noopener,noreferrer");
          else if (t.action === "shortcuts") shell?.setShortcutsOpen(true);
          else if (t.action === "ask") {
            shell?.setCommandOpen(false);
            onAsk?.(t.question);
          }
        },
      })),
    });
    return { leading: built.leading.map(view), trailing: built.trailing.map(view) };
  }, [s, workflows.data, runs.data, templates.data, query, pending, router, shell, onAsk]);

  return (
    <CommandMenu
      pages={pages}
      actions={actions}
      leadingGroups={groups.leading}
      extraGroups={groups.trailing}
      search={query}
      onSearchChange={setQuery}
      placeholder="Search pages, workflows, runs or settings…"
    />
  );
}
