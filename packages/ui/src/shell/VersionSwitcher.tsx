import { forwardRef, type ButtonHTMLAttributes } from "react";
import { ChevronDown, ExternalLink, GitCompare, RotateCcw } from "lucide-react";
import { cn } from "@/lib/cn";
import type { WorkflowVersionView } from "@/types";
import {
  Badge,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/primitives";

/** "Draft" when nothing is published, otherwise "v12 Production", "v13 Draft", "v11" or "v9 Archived". */
export function versionLabel(version?: WorkflowVersionView): string {
  if (!version) return "Draft";
  switch (version.status) {
    case "draft":
      return `v${version.version} Draft`;
    case "production":
      return `v${version.version} Production`;
    case "published":
      return `v${version.version}`;
    case "archived":
      return `v${version.version} Archived`;
  }
}

const STATUS_TONE: Record<WorkflowVersionView["status"], "ok" | "warn" | "neutral" | "outline"> = {
  production: "ok",
  draft: "warn",
  published: "neutral",
  archived: "outline",
};

function versionDate(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  return new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export interface VersionSwitcherProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "onSelect"
> {
  /** Every version, newest first. */
  versions: WorkflowVersionView[];
  /** Id of the version currently open in the editor; defaults to the first draft, then the first version. */
  currentId?: string;
  onOpen?: (version: WorkflowVersionView) => void;
  /** Compare the given version against the current one. */
  onCompare?: (version: WorkflowVersionView) => void;
  /** Make the given version production. */
  onRollback?: (version: WorkflowVersionView) => void;
  /** Cap the versions listed in the menu (default 8). */
  limit?: number;
  onViewAll?: () => void;
}

/**
 * Top-bar version pill with a menu of versions. Draft is amber, production
 * green; every row shows node count and date in mono, and a sub-menu holds
 * open / compare / rollback so the primary click is always "open".
 */
export const VersionSwitcher = forwardRef<HTMLButtonElement, VersionSwitcherProps>(
  function VersionSwitcher(
    {
      versions,
      currentId,
      onOpen,
      onCompare,
      onRollback,
      limit = 8,
      onViewAll,
      className,
      ...rest
    },
    ref,
  ) {
    const current =
      versions.find((v) => v.id === currentId) ??
      versions.find((v) => v.status === "draft") ??
      versions[0];
    const tone = current ? STATUS_TONE[current.status] : "warn";
    const listed = versions.slice(0, limit);
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            ref={ref}
            type="button"
            aria-label={`Version: ${versionLabel(current)}`}
            className={cn(
              "group inline-flex h-7 shrink-0 cursor-pointer items-center gap-1 rounded-sm border border-transparent px-1 text-xs transition-colors duration-(--dur-fast) hover:bg-surface-3 data-[state=open]:bg-surface-3",
              className,
            )}
            {...rest}
          >
            <Badge tone={tone} dot mono>
              {versionLabel(current)}
            </Badge>
            <ChevronDown
              className="size-3.5 text-ink-3 transition-colors group-hover:text-ink-3"
              strokeWidth={1.75}
              aria-hidden="true"
            />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-64">
          <DropdownMenuLabel>Versions</DropdownMenuLabel>
          {listed.length === 0 ? (
            <div className="px-2 py-3 text-xs text-ink-3">
              No versions yet. Publish to create v1.
            </div>
          ) : null}
          {listed.map((v) => {
            const isCurrent = v.id === current?.id;
            const label = (
              <span className="flex min-w-0 flex-1 items-center gap-2">
                <span className="font-mono text-xs tabular">v{v.version}</span>
                <Badge tone={STATUS_TONE[v.status]} size="sm">
                  {v.status}
                </Badge>
                <span className="min-w-0 flex-1 truncate text-xs text-ink-2">{v.message}</span>
                <span className="shrink-0 font-mono text-2xs text-ink-3 tabular">
                  {v.nodeCount} nodes · {versionDate(v.createdAt)}
                </span>
              </span>
            );
            const hasActions = onCompare || onRollback;
            if (!hasActions) {
              return (
                <DropdownMenuItem
                  key={v.id}
                  onSelect={() => onOpen?.(v)}
                  className={cn(isCurrent && "bg-surface-2")}
                >
                  {label}
                </DropdownMenuItem>
              );
            }
            return (
              <DropdownMenuSub key={v.id}>
                <DropdownMenuSubTrigger className={cn(isCurrent && "bg-surface-2")}>
                  {label}
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  <DropdownMenuItem
                    icon={<ExternalLink strokeWidth={1.75} />}
                    onSelect={() => onOpen?.(v)}
                    disabled={!onOpen}
                  >
                    Open v{v.version}
                  </DropdownMenuItem>
                  {onCompare ? (
                    <DropdownMenuItem
                      icon={<GitCompare strokeWidth={1.75} />}
                      onSelect={() => onCompare(v)}
                      disabled={isCurrent}
                    >
                      Compare with current
                    </DropdownMenuItem>
                  ) : null}
                  {onRollback ? (
                    <DropdownMenuItem
                      icon={<RotateCcw strokeWidth={1.75} />}
                      onSelect={() => onRollback(v)}
                      disabled={v.status !== "published" && v.status !== "archived"}
                      description={
                        v.status === "production"
                          ? "Already in production"
                          : v.status === "draft"
                            ? "Publish the draft first"
                            : undefined
                      }
                    >
                      Roll back production to v{v.version}
                    </DropdownMenuItem>
                  ) : null}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            );
          })}
          {onViewAll ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={onViewAll}>
                View all versions
                <span className="ml-auto font-mono text-2xs text-ink-3 tabular">
                  {versions.length}
                </span>
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  },
);
