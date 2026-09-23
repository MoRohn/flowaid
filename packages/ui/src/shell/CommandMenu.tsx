import { useMemo, useState, type ReactNode } from "react";
import { Monitor, Moon, Play, Sparkles, Sun, Workflow } from "lucide-react";
import { formatMs } from "@/lib/format";
import { statusLabel } from "@/primitives";
import { CommandPalette, type CommandGroupView, type CommandItemView } from "./CommandPalette";
import { useTheme, type ThemeSetting } from "@/theme";
import type { RunStatus } from "@/lib/categories";
import { useAppShellOptional } from "./AppShellContext";

export interface CommandMenuPage {
  id: string;
  label: string;
  icon?: ReactNode;
  /** Sequence shortcut shown at the right, e.g. "g w". */
  shortcut?: string;
  keywords?: string[];
  onSelect: () => void;
}

export interface CommandMenuAction {
  id: string;
  label: string;
  description?: string;
  icon?: ReactNode;
  shortcut?: string;
  keywords?: string[];
  disabled?: boolean;
  onSelect: () => void;
}

export type CommandMenuRecent =
  | {
      kind: "workflow";
      id: string;
      name: string;
      /** Mono meta, e.g. "v12 · 9 nodes". */
      meta?: string;
      onSelect: () => void;
    }
  | {
      kind: "run";
      id: string;
      workflowName: string;
      status: RunStatus;
      durationMs?: number;
      onSelect: () => void;
    };

export interface CommandMenuProps {
  /** Controlled open state; omit inside AppShell to bind to its mod+K state. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  pages?: CommandMenuPage[];
  /** Workflow actions (run, publish, validate, add node). */
  actions?: CommandMenuAction[];
  recent?: CommandMenuRecent[];
  /** Adds the "Ask AI builder" item, called with the typed query. */
  onAskAi?: (query: string) => void;
  /** Hide the theme group. */
  themeGroup?: boolean;
  /** Extra groups appended after the built-in ones. */
  extraGroups?: CommandGroupView[];
  placeholder?: string;
}

/**
 * The global ⌘K menu built on CommandPalette: Navigate, Workflow actions,
 * Recent workflows and runs, and Theme. With `onAskAi`, whatever is typed can
 * be handed to the AI builder as the first item.
 */
export function CommandMenu({
  open: openProp,
  onOpenChange,
  pages = [],
  actions = [],
  recent = [],
  onAskAi,
  themeGroup = true,
  extraGroups = [],
  placeholder = "Search pages, workflows, runs or type a command…",
}: CommandMenuProps) {
  const shell = useAppShellOptional();
  const open = openProp ?? shell?.commandOpen ?? false;
  const setOpen = (next: boolean) => {
    onOpenChange?.(next);
    if (openProp === undefined && shell) shell.setCommandOpen(next);
  };
  const { setting, setTheme } = useTheme();
  const [query, setQuery] = useState("");

  const groups = useMemo<CommandGroupView[]>(() => {
    const list: CommandGroupView[] = [];
    const trimmed = query.trim();
    if (onAskAi) {
      list.push({
        id: "ai",
        items: [
          {
            id: "ask-ai",
            label: trimmed ? `Ask AI builder: “${trimmed}”` : "Ask AI builder",
            description: trimmed
              ? "Describe a change and the builder proposes nodes"
              : "Describe what the workflow should do",
            icon: <Sparkles strokeWidth={1.75} />,
            keywords: ["ai", "assistant", "generate", "build", trimmed],
            meta: "AI",
            onSelect: () => onAskAi(trimmed),
          },
        ],
      });
    }
    if (pages.length > 0) {
      list.push({
        id: "navigate",
        heading: "Navigate",
        items: pages.map<CommandItemView>((p) => ({
          id: p.id,
          label: p.label,
          icon: p.icon ?? <Workflow strokeWidth={1.75} />,
          shortcut: p.shortcut,
          keywords: ["go to", "open", ...(p.keywords ?? [])],
          onSelect: p.onSelect,
        })),
      });
    }
    if (actions.length > 0) {
      list.push({
        id: "workflow",
        heading: "Workflow",
        items: actions.map<CommandItemView>((a) => ({
          id: a.id,
          label: a.label,
          description: a.description,
          icon: a.icon,
          shortcut: a.shortcut,
          keywords: a.keywords,
          disabled: a.disabled,
          onSelect: a.onSelect,
        })),
      });
    }
    if (recent.length > 0) {
      list.push({
        id: "recent",
        heading: "Recent",
        items: recent.map<CommandItemView>((r) =>
          r.kind === "workflow"
            ? {
                id: `wf-${r.id}`,
                label: r.name,
                icon: <Workflow strokeWidth={1.75} />,
                meta: r.meta,
                keywords: ["workflow", "recent"],
                onSelect: r.onSelect,
              }
            : {
                id: `run-${r.id}`,
                label: r.workflowName,
                description: `${statusLabel(r.status)} · ${r.id}`,
                icon: <Play strokeWidth={1.75} />,
                meta: r.durationMs !== undefined ? formatMs(r.durationMs) : undefined,
                keywords: ["run", "recent", r.id, r.status],
                onSelect: r.onSelect,
              },
        ),
      });
    }
    if (themeGroup) {
      const themes: Array<{ id: ThemeSetting; label: string; icon: ReactNode }> = [
        { id: "light", label: "Light", icon: <Sun strokeWidth={1.75} /> },
        { id: "dark", label: "Dark", icon: <Moon strokeWidth={1.75} /> },
        { id: "system", label: "System", icon: <Monitor strokeWidth={1.75} /> },
      ];
      list.push({
        id: "theme",
        heading: "Theme",
        items: themes.map<CommandItemView>((t) => ({
          id: `theme-${t.id}`,
          label: `Theme: ${t.label}`,
          icon: t.icon,
          meta: setting === t.id ? "current" : undefined,
          keywords: ["theme", "appearance", "dark mode", "light mode"],
          onSelect: () => setTheme(t.id),
        })),
      });
    }
    return [...list, ...extraGroups];
  }, [query, onAskAi, pages, actions, recent, themeGroup, setting, setTheme, extraGroups]);

  return (
    <CommandPalette
      open={open}
      onOpenChange={setOpen}
      groups={groups}
      search={query}
      onSearchChange={setQuery}
      placeholder={placeholder}
      label="Command menu"
    />
  );
}
