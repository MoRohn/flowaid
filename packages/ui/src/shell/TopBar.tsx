import { forwardRef, useRef, useState, type HTMLAttributes, type ReactNode } from "react";
import {
  Copy,
  Ellipsis,
  FileCode,
  Menu,
  PanelBottom,
  PanelRight,
  Play,
  Rocket,
  Trash,
  Upload,
} from "lucide-react";
import { cn } from "@/lib/cn";
import type { WorkflowVersionView } from "@/types";
import {
  Button,
  ConfirmDialog,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  IconButton,
  LogoMark,
  Separator,
  Shortcut,
  TooltipProvider,
} from "@/primitives";
import { useAppShellOptional } from "./AppShellContext";
import { useContainerWidth } from "./useContainerWidth";
import { Breadcrumbs, type BreadcrumbItem } from "./Breadcrumbs";
import type { EnvironmentId, EnvironmentView } from "@/types";
import { EnvironmentSwitcher } from "./EnvironmentSwitcher";
import { SaveIndicator, type SaveState } from "./SaveIndicator";
import { VersionSwitcher, type VersionSwitcherProps } from "./VersionSwitcher";

export interface TopBarProps extends Omit<HTMLAttributes<HTMLElement>, "title"> {
  breadcrumbs: BreadcrumbItem[];
  /** Enables inline rename of the last crumb. */
  onRename?: (name: string) => void;
  onLogoClick?: () => void;
  /** The workspace's environments (`{ id, name, protected }[]`); required for the switcher. */
  environments?: readonly EnvironmentView[];
  environment?: EnvironmentId;
  onEnvironmentChange?: (env: EnvironmentId) => void;
  /** Versions for the badge; omit to hide it. */
  versions?: WorkflowVersionView[];
  currentVersionId?: string;
  versionActions?: Pick<VersionSwitcherProps, "onOpen" | "onCompare" | "onRollback" | "onViewAll">;
  saveState?: SaveState;
  savedAt?: string;
  /** Error detail when `saveState` is "error". */
  saveError?: string;
  onRun?: () => void;
  running?: boolean;
  /** Shortcut shown on the Run button (default "mod+enter"). */
  runShortcut?: string;
  onPublish?: () => void;
  publishing?: boolean;
  /** Disable Publish (validation errors, nothing changed). */
  publishDisabled?: boolean;
  onDuplicate?: () => void;
  onExportJson?: () => void;
  onImport?: () => void;
  onDelete?: () => void;
  /** Rendered before the breadcrumbs (a menu button in compact layouts). */
  leading?: ReactNode;
  /** Rendered after the primary actions (a UserMenu). */
  trailing?: ReactNode;
  /** Inspector / bottom panel toggles; default on when inside AppShell. */
  layoutToggles?: boolean;
  /** Force a density instead of measuring the bar: "full" shows everything, "dense" collapses to icons. */
  density?: TopBarDensity;
}

export type TopBarDensity = "full" | "medium" | "dense";

/** Below 840px the bar collapses to icons; below 1080px it drops the environment control and the save label. */
export function topBarDensity(width: number): TopBarDensity {
  if (width < 840) return "dense";
  if (width < 1080) return "medium";
  return "full";
}

/**
 * 44px application bar. Left: mark and breadcrumbs. Centre: nothing. Right:
 * environment, version, save state, Run (secondary, with its shortcut),
 * Publish (the only filled button) and an overflow menu. Every action is a
 * callback; the bar owns no state.
 */
export const TopBar = forwardRef<HTMLElement, TopBarProps>(function TopBar(
  {
    breadcrumbs,
    onRename,
    onLogoClick,
    environments,
    environment,
    onEnvironmentChange,
    versions,
    currentVersionId,
    versionActions,
    saveState,
    savedAt,
    saveError,
    onRun,
    running = false,
    runShortcut = "mod+enter",
    onPublish,
    publishing = false,
    publishDisabled = false,
    onDuplicate,
    onExportJson,
    onImport,
    onDelete,
    leading,
    trailing,
    layoutToggles,
    density: densityProp,
    className,
    ...rest
  },
  ref,
) {
  const shell = useAppShellOptional();
  const innerRef = useRef<HTMLElement>(null);
  const width = useContainerWidth(innerRef);
  const density: TopBarDensity =
    densityProp ?? (shell?.compact ? "dense" : width === undefined ? "full" : topBarDensity(width));
  const compact = density === "dense";
  const medium = density === "medium";
  const showToggles = layoutToggles ?? shell !== null;
  const envInMenu =
    environments !== undefined &&
    environment !== undefined &&
    onEnvironmentChange !== undefined &&
    density !== "full";
  const [pendingProduction, setPendingProduction] = useState<string | null>(null);
  const pendingEnv = environments?.find((e) => e.id === pendingProduction);
  const hasOverflow = onDuplicate || onExportJson || onImport || onDelete || envInMenu;
  const setRef = (node: HTMLElement | null) => {
    innerRef.current = node;
    if (typeof ref === "function") ref(node);
    else if (ref) ref.current = node;
  };
  const menuButton =
    compact && shell ? (
      <IconButton
        label="Open navigation"
        shortcut="mod+b"
        onClick={() => shell.setNavDrawerOpen(true)}
        className="-ml-1"
      >
        <Menu strokeWidth={1.75} />
      </IconButton>
    ) : null;

  return (
    <TooltipProvider>
      <header
        ref={setRef}
        data-density={density}
        className={cn(
          "flex h-11 shrink-0 items-center gap-2 border-b border-border bg-surface px-3 text-ink",
          className,
        )}
        {...rest}
      >
        {leading ?? menuButton}
        {onLogoClick ? (
          <button
            type="button"
            aria-label="Home"
            onClick={onLogoClick}
            className="flex size-7 shrink-0 items-center justify-center rounded-sm text-ink transition-colors duration-(--dur-fast) hover:bg-surface-3"
          >
            <LogoMark size={20} />
          </button>
        ) : (
          <span className="flex size-7 shrink-0 items-center justify-center text-ink">
            <LogoMark size={20} title="FlowAId" />
          </span>
        )}
        <Breadcrumbs
          items={compact ? breadcrumbs.slice(-1) : breadcrumbs}
          onRename={onRename}
          className="min-w-0 flex-1"
        />

        <div className="ml-auto flex shrink-0 items-center gap-2">
          {environments && environment && onEnvironmentChange && density === "full" ? (
            <EnvironmentSwitcher
              environments={environments}
              value={environment}
              onChange={onEnvironmentChange}
              size="sm"
              short
            />
          ) : null}
          {versions && !compact ? (
            <VersionSwitcher versions={versions} currentId={currentVersionId} {...versionActions} />
          ) : null}
          {saveState ? (
            <SaveIndicator
              state={saveState}
              savedAt={savedAt}
              error={saveError}
              compact={compact}
            />
          ) : null}
          {!compact && (environment || versions || saveState) && (onRun || onPublish) ? (
            <Separator orientation="vertical" className="mx-0.5 h-5" />
          ) : null}
          {onRun && compact ? (
            <IconButton
              label="Run"
              shortcut={runShortcut}
              variant="secondary"
              onClick={onRun}
              loading={running}
            >
              <Play strokeWidth={1.75} />
            </IconButton>
          ) : onRun ? (
            <Button
              variant="secondary"
              onClick={onRun}
              loading={running}
              leadingIcon={<Play strokeWidth={1.75} />}
              trailingIcon={
                medium ? undefined : (
                  <Shortcut
                    shortcut={runShortcut}
                    size="sm"
                    className="ml-0.5 border-border-strong/60 bg-transparent"
                  />
                )
              }
            >
              Run
            </Button>
          ) : null}
          {onPublish && compact ? (
            <IconButton
              label="Publish"
              variant="primary"
              onClick={onPublish}
              loading={publishing}
              disabled={publishDisabled}
            >
              <Rocket strokeWidth={1.75} />
            </IconButton>
          ) : onPublish ? (
            <Button
              variant="primary"
              onClick={onPublish}
              loading={publishing}
              disabled={publishDisabled}
              leadingIcon={<Rocket strokeWidth={1.75} />}
            >
              Publish
            </Button>
          ) : null}
          {hasOverflow ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton label="More actions" tooltip={false}>
                  <Ellipsis strokeWidth={1.75} />
                </IconButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {envInMenu && environments && environment && onEnvironmentChange ? (
                  <>
                    <DropdownMenuLabel>Environment</DropdownMenuLabel>
                    <DropdownMenuRadioGroup
                      value={environment}
                      onValueChange={(v) => {
                        if (v === environment) return;
                        const env = environments.find((e) => e.id === v);
                        if (!env) return;
                        if (env.protected) setPendingProduction(env.id);
                        else onEnvironmentChange(env.id);
                      }}
                    >
                      {environments.map((env) => (
                        <DropdownMenuRadioItem key={env.id} value={env.id}>
                          {env.name}
                        </DropdownMenuRadioItem>
                      ))}
                    </DropdownMenuRadioGroup>
                    {onDuplicate || onExportJson || onImport || onDelete ? (
                      <DropdownMenuSeparator />
                    ) : null}
                  </>
                ) : null}
                {onDuplicate ? (
                  <DropdownMenuItem
                    icon={<Copy strokeWidth={1.75} />}
                    onSelect={onDuplicate}
                    shortcut="mod+d"
                  >
                    Duplicate
                  </DropdownMenuItem>
                ) : null}
                {onExportJson ? (
                  <DropdownMenuItem icon={<FileCode strokeWidth={1.75} />} onSelect={onExportJson}>
                    Export JSON
                  </DropdownMenuItem>
                ) : null}
                {onImport ? (
                  <DropdownMenuItem icon={<Upload strokeWidth={1.75} />} onSelect={onImport}>
                    Import
                  </DropdownMenuItem>
                ) : null}
                {onDelete ? (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      icon={<Trash strokeWidth={1.75} />}
                      onSelect={onDelete}
                      destructive
                    >
                      Delete workflow
                    </DropdownMenuItem>
                  </>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
          {showToggles && shell ? (
            <>
              {compact ? null : <Separator orientation="vertical" className="mx-0.5 h-5" />}
              {compact ? null : (
                <IconButton
                  label={shell.layout.bottomOpen ? "Hide bottom panel" : "Show bottom panel"}
                  shortcut="mod+j"
                  aria-pressed={shell.layout.bottomOpen}
                  onClick={shell.toggleBottom}
                  className={cn(shell.layout.bottomOpen && "text-ink")}
                >
                  <PanelBottom strokeWidth={1.75} />
                </IconButton>
              )}
              <IconButton
                label={shell.layout.inspectorOpen ? "Hide inspector" : "Show inspector"}
                shortcut="mod+i"
                aria-pressed={shell.layout.inspectorOpen}
                onClick={shell.toggleInspector}
                className={cn(shell.layout.inspectorOpen && "text-ink")}
              >
                <PanelRight strokeWidth={1.75} />
              </IconButton>
            </>
          ) : null}
          {trailing}
        </div>
      </header>
      {envInMenu && onEnvironmentChange ? (
        <ConfirmDialog
          open={pendingProduction !== null}
          onOpenChange={(open) => {
            if (!open) setPendingProduction(null);
          }}
          title={`Switch to ${pendingEnv?.name ?? "this environment"}?`}
          description={`Runs, credentials and published versions will target the ${pendingEnv?.name ?? "protected"} environment.`}
          confirmLabel={`Switch to ${pendingEnv?.name ?? "environment"}`}
          onConfirm={() => {
            const id = pendingProduction;
            setPendingProduction(null);
            if (id !== null) onEnvironmentChange(id);
          }}
        />
      ) : null}
    </TooltipProvider>
  );
});
