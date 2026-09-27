"use client";
/** Sub-navigation between a workflow's pages (builder, runs, versions, deployments, settings). */
import Link from "next/link";
import { cn } from "@flowaid/ui/lib";
import { useSession } from "~/session";

const TABS = [
  { id: "builder", label: "Builder", path: "" },
  { id: "runs", label: "Runs", path: "/runs" },
  { id: "versions", label: "Versions", path: "/versions" },
  { id: "deployments", label: "Deployments", path: "/deployments" },
  { id: "settings", label: "Settings", path: "/settings" },
] as const;

export type WorkflowTabId = (typeof TABS)[number]["id"];

export function WorkflowTabs({
  workflowId,
  active,
}: {
  workflowId: string;
  active: WorkflowTabId;
}) {
  const s = useSession();
  return (
    <nav
      aria-label="Workflow"
      className="flex h-9 shrink-0 items-center gap-0.5 border-b border-border bg-surface px-3"
    >
      {TABS.map((t) => (
        <Link
          key={t.id}
          href={`/${s.ws}/workflows/${workflowId}${t.path}`}
          aria-current={t.id === active ? "page" : undefined}
          className={cn(
            "rounded-sm px-2 py-1 text-xs",
            t.id === active
              ? "bg-surface-3 font-medium text-ink"
              : "text-ink-3 hover:bg-surface-3 hover:text-ink",
          )}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
