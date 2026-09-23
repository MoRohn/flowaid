import { forwardRef, type ButtonHTMLAttributes } from "react";
import { Keyboard, LogOut, Settings, UserRound } from "lucide-react";
import { cn } from "@/lib/cn";
import {
  Avatar,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  type AvatarSize,
} from "@/primitives";

export interface UserView {
  name: string;
  email?: string;
  avatarUrl?: string;
}

export interface UserMenuProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  user: UserView;
  onProfile?: () => void;
  onPreferences?: () => void;
  onShortcuts?: () => void;
  onSignOut?: () => void;
  size?: AvatarSize;
}

/**
 * Avatar button with the account menu: profile, preferences, keyboard
 * shortcuts and sign out. Sign out is a destructive item.
 */
export const UserMenu = forwardRef<HTMLButtonElement, UserMenuProps>(function UserMenu(
  { user, onProfile, onPreferences, onShortcuts, onSignOut, size = "md", className, ...rest },
  ref,
) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          ref={ref}
          type="button"
          aria-label={`Account: ${user.name}`}
          className={cn(
            "flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-full transition-[box-shadow] duration-(--dur-fast) hover:shadow-[0_0_0_2px_var(--surface-3)] data-[state=open]:shadow-[0_0_0_2px_var(--surface-3)]",
            className,
          )}
          {...rest}
        >
          <Avatar name={user.name} src={user.avatarUrl} size={size} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-52">
        <div className="flex flex-col gap-0.5 px-2 pb-1.5 pt-1.5">
          <span className="truncate text-xs font-medium text-ink">{user.name}</span>
          {user.email ? (
            <span className="truncate font-mono text-2xs text-ink-3">{user.email}</span>
          ) : null}
        </div>
        <DropdownMenuSeparator />
        {onProfile ? (
          <DropdownMenuItem icon={<UserRound strokeWidth={1.75} />} onSelect={onProfile}>
            Profile
          </DropdownMenuItem>
        ) : null}
        {onPreferences ? (
          <DropdownMenuItem
            icon={<Settings strokeWidth={1.75} />}
            onSelect={onPreferences}
            shortcut="mod+,"
          >
            Preferences
          </DropdownMenuItem>
        ) : null}
        {onShortcuts ? (
          <DropdownMenuItem
            icon={<Keyboard strokeWidth={1.75} />}
            onSelect={onShortcuts}
            shortcut="?"
          >
            Keyboard shortcuts
          </DropdownMenuItem>
        ) : null}
        {onSignOut ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem icon={<LogOut strokeWidth={1.75} />} onSelect={onSignOut} destructive>
              Sign out
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
});
