import { forwardRef, type ButtonHTMLAttributes } from "react";
import { Check, ChevronsUpDown, Plus, Settings } from "lucide-react";
import { cn } from "@/lib/cn";
import {
  Avatar,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Tooltip,
} from "@/primitives";

export interface WorkspaceView {
  id: string;
  name: string;
  avatarUrl?: string;
  /** Plan or role line under the name. */
  plan?: string;
}

export interface WorkspaceSwitcherProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "onChange"
> {
  workspaces: WorkspaceView[];
  currentId: string;
  onChange: (id: string) => void;
  onCreate?: () => void;
  onSettings?: () => void;
  /** Avatar only, for the collapsed rail. */
  collapsed?: boolean;
}

/**
 * Workspace avatar + name with a menu of workspaces. In the collapsed rail
 * only the avatar shows and the name moves into a tooltip.
 */
export const WorkspaceSwitcher = forwardRef<HTMLButtonElement, WorkspaceSwitcherProps>(
  function WorkspaceSwitcher(
    {
      workspaces,
      currentId,
      onChange,
      onCreate,
      onSettings,
      collapsed = false,
      className,
      ...rest
    },
    ref,
  ) {
    const current = workspaces.find((w) => w.id === currentId) ?? workspaces[0];
    const name = current?.name ?? "Workspace";
    const trigger = (
      <button
        ref={ref}
        type="button"
        aria-label={collapsed ? `Workspace: ${name}` : undefined}
        className={cn(
          "flex h-9 w-full min-w-0 cursor-pointer items-center gap-2 rounded-sm border border-transparent text-left text-xs transition-colors duration-(--dur-fast) hover:bg-surface-3 data-[state=open]:bg-surface-3",
          collapsed ? "justify-center px-0" : "px-1.5",
          className,
        )}
        {...rest}
      >
        <Avatar name={name} src={current?.avatarUrl} size="md" shape="square" />
        {collapsed ? null : (
          <>
            <span className="flex min-w-0 flex-1 flex-col leading-tight">
              <span className="truncate font-medium text-ink">{name}</span>
              {current?.plan ? (
                <span className="truncate text-2xs text-ink-3">{current.plan}</span>
              ) : null}
            </span>
            <ChevronsUpDown
              className="size-3.5 shrink-0 text-ink-3"
              strokeWidth={1.75}
              aria-hidden="true"
            />
          </>
        )}
      </button>
    );
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          {collapsed ? (
            <Tooltip content={name} side="right">
              {trigger}
            </Tooltip>
          ) : (
            trigger
          )}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" side={collapsed ? "right" : "top"} className="min-w-56">
          <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
          {workspaces.map((w) => (
            <DropdownMenuItem
              key={w.id}
              onSelect={() => onChange(w.id)}
              icon={<Avatar name={w.name} src={w.avatarUrl} size="xs" shape="square" />}
            >
              <span className="flex min-w-0 items-center gap-2">
                <span className="min-w-0 flex-1 truncate">{w.name}</span>
                {w.id === current?.id ? (
                  <Check
                    className="size-3.5 shrink-0 text-accent"
                    strokeWidth={2}
                    aria-hidden="true"
                  />
                ) : null}
              </span>
            </DropdownMenuItem>
          ))}
          {onCreate || onSettings ? <DropdownMenuSeparator /> : null}
          {onSettings ? (
            <DropdownMenuItem icon={<Settings strokeWidth={1.75} />} onSelect={onSettings}>
              Workspace settings
            </DropdownMenuItem>
          ) : null}
          {onCreate ? (
            <DropdownMenuItem icon={<Plus strokeWidth={1.75} />} onSelect={onCreate}>
              New workspace
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  },
);
