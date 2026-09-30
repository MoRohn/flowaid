"use client";
/**
 * Settings' "Start here", one per tab: what the open tab is for, with its "What you need" lines
 * computed from the same queries the tab itself reads (so both share the cache).
 */
import { useQuery } from "@tanstack/react-query";
import { get, getAll } from "~/api/client";
import type { ApiKeySummary, Page, WorkflowSummary } from "~/api/types";
import {
  SETTINGS_API_KEYS,
  SETTINGS_AUDIT,
  SETTINGS_ENVIRONMENTS,
  SETTINGS_NOTIFICATIONS,
  SETTINGS_WORKSPACE,
} from "~/guide/capabilities/settings";
import { PageIntro } from "~/guide/PageIntro";
import type { Check } from "~/guide/Readiness";
import { useSession } from "~/session";
import type { NotificationChannel, Workspace } from "../types";
import { KIND_LABEL, NOTIFICATION_EVENTS } from "../triggers/logic";
import { expiringKeys, uncoveredEvents } from "./guidance";

const link = (href: string, label: string) => (
  <a className="text-accent-text hover:underline" href={href}>
    {label}
  </a>
);

const role = (label: string): Check => ({ id: "role", label, state: "info" });

export function SettingsIntro({ tab }: { tab: string }) {
  if (tab === "workspace") return <WorkspaceIntro />;
  if (tab === "api-keys") return <ApiKeysIntro />;
  if (tab === "environments") return <EnvironmentsIntro />;
  if (tab === "notifications") return <NotificationsIntro />;
  if (tab === "audit") return <PageIntro guide={SETTINGS_AUDIT} className="mt-4" />;
  return null;
}

function WorkspaceIntro() {
  const s = useSession();
  const id = s.me.workspaces.find((w) => w.slug === s.ws)?.id ?? "";
  const ws = useQuery({
    queryKey: ["workspace", s.ws],
    queryFn: () => get<Workspace>(`/v1/workspaces/${id}`),
  });
  const budget = (ws.data?.settings.budgets as { monthlyCostUsd?: number } | undefined)
    ?.monthlyCostUsd;
  const checks: Check[] = [
    ws.isPending
      ? { id: "budget", label: "Monthly budget", state: "checking" }
      : budget !== undefined
        ? {
            id: "budget",
            label: `Monthly budget: $${budget}`,
            state: "ok",
            detail: "The workflow advisor compares each workflow's cost per run with it.",
          }
        : {
            id: "budget",
            label: "No monthly budget",
            state: "optional",
            detail: "Without one the advisor cannot say whether a workflow's cost fits.",
          },
    ...(s.can("admin") ? [] : [role("Your role can see these settings but not change them")]),
  ];
  return (
    <PageIntro guide={SETTINGS_WORKSPACE} checks={checks} defaultCollapsed={budget !== undefined} />
  );
}

function ApiKeysIntro() {
  const s = useSession();
  const keys = useQuery({
    queryKey: ["api-keys", s.ws],
    queryFn: () => getAll<ApiKeySummary>("/v1/api-keys"),
  });
  const workflows = useQuery({
    queryKey: ["workflow-names", s.ws],
    queryFn: () => get<Page<WorkflowSummary>>("/v1/workflows?limit=200"),
    select: (p) => p.items,
  });
  const active = (keys.data ?? []).filter((k) => !k.revokedAt);
  const published = (workflows.data ?? []).filter((w) => w.latestVersionId !== null).length;
  const soon = expiringKeys(active);
  const checks: Check[] = [
    workflows.isPending
      ? { id: "published", label: "A published workflow", state: "checking" }
      : published > 0
        ? {
            id: "published",
            label: `${published} workflow${published === 1 ? " has" : "s have"} a published version`,
            state: "ok",
            detail:
              "A key calls the version deployed to its environment; deploy from the workflow's Deployments.",
          }
        : {
            id: "published",
            label: "A published workflow to call",
            state: "warning",
            detail:
              "A key can be created now, but its run requests fail until a version is published and deployed.",
            fix: link(`/${s.ws}/workflows`, "Open Workflows"),
          },
    ...(soon.length
      ? [
          {
            id: "expiring",
            label: `${soon.length === 1 ? "1 key expires" : `${soon.length} keys expire`} within 14 days: ${soon.map((k) => k.name).join(", ")}`,
            state: "warning",
            detail:
              "Rotate it to get a new key with the same settings; the old one keeps working for the grace period.",
          } satisfies Check,
        ]
      : []),
    ...(s.can("admin") ? [] : [role("Service-account keys need an admin")]),
  ];
  return (
    <PageIntro guide={SETTINGS_API_KEYS} checks={checks} defaultCollapsed={active.length > 0} />
  );
}

function EnvironmentsIntro() {
  const s = useSession();
  const dev = s.environments.find((e) => e.name === "dev");
  const guarded = s.environments.filter((e) => e.protected);
  const checks: Check[] = [
    dev
      ? { id: "dev", label: "dev exists: Run draft uses it", state: "ok" }
      : {
          id: "dev",
          label: "No dev environment",
          state: "warning",
          detail:
            "Draft runs and runs started from the app without an environment use dev, and fail without it.",
        },
    guarded.length
      ? {
          id: "protected",
          label: `Protected: ${guarded.map((e) => e.name).join(", ")}`,
          state: "ok",
          detail: "Only admins deploy there.",
        }
      : {
          id: "protected",
          label: "No protected environment",
          state: "warning",
          detail:
            "Anyone who can publish can deploy to every environment. Protect the one that answers real requests.",
        },
    ...(s.can("admin") ? [] : [role("Only admins create, change or delete environments")]),
  ];
  // the three defaults are there from the start: open until something was changed
  const changed =
    s.environments.length > 3 ||
    s.environments.some((e) => Object.keys(e.variables ?? {}).length > 0);
  return <PageIntro guide={SETTINGS_ENVIRONMENTS} checks={checks} defaultCollapsed={changed} />;
}

function NotificationsIntro() {
  const s = useSession();
  const channels = useQuery({
    queryKey: ["notifications", s.ws],
    queryFn: () => getAll<NotificationChannel>("/v1/notifications"),
    enabled: s.can("admin"),
  });
  const rows = channels.data ?? [];
  const on = rows.filter((c) => c.enabled);
  const missing = uncoveredEvents(rows);
  const label = (id: string) => NOTIFICATION_EVENTS.find((e) => e.id === id)?.label ?? id;
  const checks: Check[] = channels.isPending
    ? [{ id: "channels", label: "Channels", state: "checking" }]
    : [
        on.length
          ? {
              id: "channels",
              label: `${on.length} channel${on.length === 1 ? "" : "s"} on: ${[
                ...new Set(on.map((c) => KIND_LABEL[c.kind])),
              ].join(", ")}`,
              state: "ok",
            }
          : {
              id: "channels",
              label: rows.length ? "Every channel is turned off" : "No channel yet",
              state: "optional",
              detail: "Without one, runs that wait or fail show only in the app.",
            },
        ...(on.length && missing.length
          ? [
              {
                id: "coverage",
                label: `Not sent anywhere: ${missing.map((e) => label(e).toLowerCase()).join("; ")}`,
                state: "warning",
                detail: "Add the event to a channel so someone hears about it.",
              } satisfies Check,
            ]
          : []),
      ];
  return (
    <PageIntro guide={SETTINGS_NOTIFICATIONS} checks={checks} defaultCollapsed={rows.length > 0} />
  );
}
