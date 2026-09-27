/**
 * Side navigation keyed by `FeatureKey` (UI.md §1): an entry renders only when the API reports its
 * feature, so the nav never links to a surface this deployment does not ship.
 */
import type { ReactNode } from "react";
import {
  Bot,
  CheckSquare,
  FlaskConical,
  KeyRound,
  LayoutDashboard,
  LayoutTemplate,
  Play,
  Plug,
  Settings,
  Workflow,
} from "lucide-react";

export interface NavEntry {
  id: string;
  label: string;
  /** every key must be enabled (any of `anyOf` when given) */
  feature?: string;
  anyOf?: string[];
  icon: ReactNode;
  path: string;
  shortcut?: string;
}

const ICON = { strokeWidth: 1.75 } as const;

export const NAV: NavEntry[] = [
  {
    id: "dashboard",
    label: "Overview",
    feature: "dashboard",
    icon: <LayoutDashboard {...ICON} />,
    path: "",
    shortcut: "g o",
  },
  {
    id: "workflows",
    label: "Workflows",
    feature: "workflows",
    icon: <Workflow {...ICON} />,
    path: "workflows",
    shortcut: "g w",
  },
  {
    id: "agents",
    label: "Agents",
    feature: "agents",
    icon: <Bot {...ICON} />,
    path: "agents",
    shortcut: "g a",
  },
  {
    id: "runs",
    label: "Runs",
    feature: "runs",
    icon: <Play {...ICON} />,
    path: "runs",
    shortcut: "g r",
  },
  {
    id: "human-tasks",
    label: "Human tasks",
    feature: "human_tasks",
    icon: <CheckSquare {...ICON} />,
    path: "human-tasks",
    shortcut: "g h",
  },
  {
    id: "templates",
    label: "Templates",
    feature: "templates",
    icon: <LayoutTemplate {...ICON} />,
    path: "templates",
  },
  {
    id: "integrations",
    label: "Integrations",
    anyOf: [
      "integrations_mcp",
      "integrations_openapi",
      "integrations_providers",
      "integrations_plugins",
    ],
    icon: <Plug {...ICON} />,
    path: "integrations",
  },
  {
    id: "evaluations",
    label: "Evaluations",
    feature: "evaluations",
    icon: <FlaskConical {...ICON} />,
    path: "evaluations",
  },
  {
    id: "credentials",
    label: "Credentials",
    feature: "credentials",
    icon: <KeyRound {...ICON} />,
    path: "credentials",
  },
];

export const NAV_SECONDARY: NavEntry[] = [
  {
    id: "settings",
    label: "Settings",
    icon: <Settings {...ICON} />,
    path: "settings",
    shortcut: "g s",
  },
];

export function visibleNav(entries: NavEntry[], features: Record<string, boolean>): NavEntry[] {
  return entries.filter((e) =>
    e.anyOf ? e.anyOf.some((k) => features[k]) : e.feature ? features[e.feature] === true : true,
  );
}
