import {
  forwardRef,
  useCallback,
  useRef,
  type HTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { Monitor, Moon, PanelLeftClose, PanelLeftOpen, Sun } from "lucide-react";
import { cn } from "@/lib/cn";
import { IconButton, Tooltip, TooltipProvider } from "@/primitives";
import { useTheme, type ThemeSetting } from "@/theme";
import { useAppShellOptional } from "./AppShellContext";
import { WorkspaceSwitcher, type WorkspaceSwitcherProps } from "./WorkspaceSwitcher";

export interface SideNavItem {
  id: string;
  label: string;
  icon: ReactNode;
  href?: string;
  /** Count badge (open runs, pending approvals). */
  count?: number;
  /** Tone for the count: warn draws the eye to pending approvals. */
  countTone?: "neutral" | "warn" | "danger";
  disabled?: boolean;
  /** Shortcut hint shown in the collapsed tooltip, e.g. "g w". */
  shortcut?: string;
}

export interface SideNavProps extends Omit<HTMLAttributes<HTMLElement>, "onSelect"> {
  items: SideNavItem[];
  /** Secondary items pinned above the footer (Settings). */
  secondaryItems?: SideNavItem[];
  activeId?: string;
  onNavigate?: (id: string, item: SideNavItem) => void;
  /** Icon rail. Defaults to the AppShell's persisted state when inside one. */
  collapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
  /** Workspace switcher props for the footer; omit to hide it. */
  workspace?: Omit<WorkspaceSwitcherProps, "collapsed">;
  /** Hide the light/dark/system toggle. */
  themeToggle?: boolean;
  /** Content above the items (a "New workflow" button); a function receives the collapsed state. */
  header?: ReactNode | ((collapsed: boolean) => ReactNode);
}

const THEME_ORDER: ThemeSetting[] = ["light", "dark", "system"];
const THEME_ICON: Record<ThemeSetting, ReactNode> = {
  light: <Sun strokeWidth={1.75} />,
  dark: <Moon strokeWidth={1.75} />,
  system: <Monitor strokeWidth={1.75} />,
};
const THEME_LABEL: Record<ThemeSetting, string> = {
  light: "Light",
  dark: "Dark",
  system: "System",
};

function ThemeToggle({ collapsed }: { collapsed: boolean }) {
  const { setting, setTheme } = useTheme();
  if (collapsed) {
    const next = THEME_ORDER[(THEME_ORDER.indexOf(setting) + 1) % THEME_ORDER.length] ?? "system";
    return (
      <IconButton
        label={`Theme: ${THEME_LABEL[setting]}`}
        tooltipSide="right"
        onClick={() => setTheme(next)}
        aria-label={`Theme: ${THEME_LABEL[setting]}. Switch to ${THEME_LABEL[next]}`}
      >
        {THEME_ICON[setting]}
      </IconButton>
    );
  }
  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      className="flex h-7 items-center gap-0.5 rounded-sm border border-border bg-surface-2 p-0.5"
    >
      {THEME_ORDER.map((t) => (
        <Tooltip key={t} content={THEME_LABEL[t]}>
          <button
            type="button"
            role="radio"
            aria-checked={setting === t}
            aria-label={THEME_LABEL[t]}
            onClick={() => setTheme(t)}
            className={cn(
              "flex h-full flex-1 cursor-pointer items-center justify-center rounded-xs px-1.5 text-ink-3 transition-colors duration-(--dur-fast) hover:text-ink [&_svg]:size-3.5",
              setting === t && "bg-surface text-ink shadow-1",
            )}
          >
            {THEME_ICON[t]}
          </button>
        </Tooltip>
      ))}
    </div>
  );
}

/**
 * Primary navigation: 208px with labels, or a 48px icon rail with tooltips.
 * Arrow keys move between items (roving tabindex), Home/End jump. Active item
 * is surface-3 + ink with a 2px accent bar on the left edge. The footer
 * holds the workspace switcher and the theme toggle.
 */
export const SideNav = forwardRef<HTMLElement, SideNavProps>(function SideNav(
  {
    items,
    secondaryItems = [],
    activeId,
    onNavigate,
    collapsed: collapsedProp,
    onCollapsedChange,
    workspace,
    themeToggle = true,
    header,
    className,
    ...rest
  },
  ref,
) {
  const shell = useAppShellOptional();
  const collapsed = collapsedProp ?? (shell ? shell.layout.navCollapsed && !shell.compact : false);
  const setCollapsed = (next: boolean) => {
    onCollapsedChange?.(next);
    if (collapsedProp === undefined && shell) shell.setNavCollapsed(next);
  };
  const listRef = useRef<HTMLDivElement>(null);

  const onKeyDown = useCallback((e: KeyboardEvent<HTMLDivElement>) => {
    const keys = ["ArrowDown", "ArrowUp", "Home", "End"];
    if (!keys.includes(e.key)) return;
    const root = listRef.current;
    if (!root) return;
    const focusable = Array.from(
      root.querySelectorAll<HTMLElement>('[data-nav-item]:not([aria-disabled="true"])'),
    );
    if (focusable.length === 0) return;
    const index = focusable.findIndex((el) => el === document.activeElement);
    let next = index;
    if (e.key === "ArrowDown") next = (index + 1) % focusable.length;
    else if (e.key === "ArrowUp") next = (index - 1 + focusable.length) % focusable.length;
    else if (e.key === "Home") next = 0;
    else next = focusable.length - 1;
    e.preventDefault();
    focusable[next]?.focus();
  }, []);

  const renderItem = (item: SideNavItem) => {
    const active = item.id === activeId;
    const classes = cn(
      "group/item relative flex h-8 w-full items-center gap-2.5 rounded-sm text-xs outline-none transition-colors duration-(--dur-fast) ease-(--ease-out)",
      collapsed ? "justify-center px-0" : "px-2",
      active ? "bg-surface-3 font-medium text-ink" : "text-ink-2 hover:bg-surface-3 hover:text-ink",
      item.disabled && "pointer-events-none opacity-50",
      "[&_svg]:size-4 [&_svg]:shrink-0",
      active ? "[&_svg]:text-ink" : "[&_svg]:text-ink-3 group-hover/item:[&_svg]:text-ink-2",
    );
    const inner = (
      <>
        {active ? (
          <span
            aria-hidden="true"
            className={cn(
              "absolute top-1.5 bottom-1.5 w-0.5 rounded-r-full bg-accent",
              collapsed ? "-left-1.5" : "-left-2",
            )}
          />
        ) : null}
        {item.icon}
        {collapsed ? (
          <span className="sr-only">{item.label}</span>
        ) : (
          <span className="min-w-0 flex-1 truncate">{item.label}</span>
        )}
        {item.count !== undefined && item.count > 0 ? (
          collapsed ? (
            <span
              aria-label={`${item.count}`}
              className={cn(
                "absolute right-1 top-1 size-1.5 rounded-full",
                item.countTone === "warn"
                  ? "bg-warn"
                  : item.countTone === "danger"
                    ? "bg-danger"
                    : "bg-ink-3",
              )}
            />
          ) : (
            <span
              className={cn(
                "shrink-0 rounded-xs px-1 font-mono text-2xs leading-4 tabular",
                item.countTone === "warn"
                  ? "bg-warn-soft text-warn-text"
                  : item.countTone === "danger"
                    ? "bg-danger-soft text-danger-text"
                    : "text-ink-3",
              )}
            >
              {item.count}
            </span>
          )
        ) : null}
      </>
    );
    const shared = {
      "data-nav-item": "",
      "aria-current": active ? ("page" as const) : undefined,
      "aria-disabled": item.disabled || undefined,
      tabIndex: active || (!activeId && items[0]?.id === item.id) ? 0 : -1,
      className: classes,
    };
    const el = item.href ? (
      <a
        href={item.href}
        {...shared}
        onClick={(e) => {
          if (onNavigate) {
            e.preventDefault();
            onNavigate(item.id, item);
          }
        }}
      >
        {inner}
      </a>
    ) : (
      <button type="button" {...shared} onClick={() => onNavigate?.(item.id, item)}>
        {inner}
      </button>
    );
    if (!collapsed) return <li key={item.id}>{el}</li>;
    return (
      <li key={item.id}>
        <Tooltip content={item.label} shortcut={item.shortcut} side="right">
          {el}
        </Tooltip>
      </li>
    );
  };

  return (
    <TooltipProvider>
      <nav
        ref={ref}
        aria-label="Primary"
        data-collapsed={collapsed || undefined}
        className={cn(
          "flex h-full shrink-0 flex-col border-r border-border bg-surface",
          "transition-[width] duration-(--dur-base) ease-(--ease-out)",
          collapsed ? "w-12" : "w-52",
          className,
        )}
        {...rest}
      >
        {header ? (
          <div className={cn("px-2 pt-2", collapsed && "flex justify-center px-1.5")}>
            {typeof header === "function" ? header(collapsed) : header}
          </div>
        ) : null}
        <div
          ref={listRef}
          role="presentation"
          onKeyDown={onKeyDown}
          className={cn(
            "flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto py-2",
            collapsed ? "px-1.5" : "px-2",
          )}
        >
          <ul className="flex flex-col gap-px">{items.map(renderItem)}</ul>
          {secondaryItems.length > 0 ? (
            <ul className="mt-auto flex flex-col gap-px border-t border-border pt-2">
              {secondaryItems.map(renderItem)}
            </ul>
          ) : null}
        </div>
        <div
          className={cn(
            "flex shrink-0 flex-col gap-1 border-t border-border p-1.5",
            collapsed && "items-center",
          )}
        >
          {workspace ? <WorkspaceSwitcher {...workspace} collapsed={collapsed} /> : null}
          <div
            className={cn("flex items-center gap-1", collapsed ? "flex-col" : "justify-between")}
          >
            {themeToggle ? <ThemeToggle collapsed={collapsed} /> : <span />}
            <IconButton
              label={collapsed ? "Expand navigation" : "Collapse navigation"}
              shortcut="mod+b"
              tooltipSide={collapsed ? "right" : "top"}
              aria-expanded={!collapsed}
              onClick={() => setCollapsed(!collapsed)}
            >
              {collapsed ? (
                <PanelLeftOpen strokeWidth={1.75} />
              ) : (
                <PanelLeftClose strokeWidth={1.75} />
              )}
            </IconButton>
          </div>
        </div>
      </nav>
    </TooltipProvider>
  );
});
