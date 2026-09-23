import {
  forwardRef,
  type ComponentPropsWithoutRef,
  type ComponentRef,
  type HTMLAttributes,
  type ReactNode,
} from "react";
import * as MenuPrimitive from "@radix-ui/react-dropdown-menu";
import { Check, ChevronRight, Circle } from "lucide-react";
import { cn } from "@/lib/cn";
import { Shortcut } from "./Kbd";

export const DropdownMenu = MenuPrimitive.Root;
export const DropdownMenuTrigger = MenuPrimitive.Trigger;
export const DropdownMenuGroup = MenuPrimitive.Group;
export const DropdownMenuSub = MenuPrimitive.Sub;
export const DropdownMenuRadioGroup = MenuPrimitive.RadioGroup;
export const DropdownMenuPortal = MenuPrimitive.Portal;

const contentClass =
  "fa-pop z-50 min-w-44 overflow-hidden rounded-md border border-border bg-surface p-1 text-sm text-ink shadow-3 outline-none";

const itemClass = [
  "relative flex h-7 cursor-default select-none items-center gap-2 rounded-xs px-2 text-sm outline-none",
  "transition-colors duration-(--dur-fast) data-highlighted:bg-surface-3",
  "data-disabled:pointer-events-none data-disabled:text-ink-4 [&_svg]:shrink-0",
].join(" ");

export type DropdownMenuContentProps = ComponentPropsWithoutRef<typeof MenuPrimitive.Content>;

/** Menu surface. Items are 28px, icons 16px in ink-3, shortcuts mono at the right edge. */
export const DropdownMenuContent = forwardRef<
  ComponentRef<typeof MenuPrimitive.Content>,
  DropdownMenuContentProps
>(function DropdownMenuContent(
  { className, sideOffset = 4, align = "start", collisionPadding = 8, ...rest },
  ref,
) {
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Content
        ref={ref}
        sideOffset={sideOffset}
        align={align}
        collisionPadding={collisionPadding}
        className={cn(
          contentClass,
          "origin-(--radix-dropdown-menu-content-transform-origin) max-h-(--radix-dropdown-menu-content-available-height) overflow-y-auto",
          className,
        )}
        {...rest}
      />
    </MenuPrimitive.Portal>
  );
});

export type DropdownMenuSubContentProps = ComponentPropsWithoutRef<typeof MenuPrimitive.SubContent>;

export const DropdownMenuSubContent = forwardRef<
  ComponentRef<typeof MenuPrimitive.SubContent>,
  DropdownMenuSubContentProps
>(function DropdownMenuSubContent(
  { className, sideOffset = 2, collisionPadding = 8, ...rest },
  ref,
) {
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.SubContent
        ref={ref}
        sideOffset={sideOffset}
        collisionPadding={collisionPadding}
        className={cn(
          contentClass,
          "origin-(--radix-dropdown-menu-content-transform-origin)",
          className,
        )}
        {...rest}
      />
    </MenuPrimitive.Portal>
  );
});

export interface DropdownMenuItemProps extends ComponentPropsWithoutRef<typeof MenuPrimitive.Item> {
  icon?: ReactNode;
  /** Shortcut string, e.g. "mod+d". */
  shortcut?: string;
  /** Danger styling for destructive actions. */
  destructive?: boolean;
  /** Small secondary line under the label. */
  description?: ReactNode;
}

export const DropdownMenuItem = forwardRef<
  ComponentRef<typeof MenuPrimitive.Item>,
  DropdownMenuItemProps
>(function DropdownMenuItem(
  { className, icon, shortcut, destructive = false, description, children, ...rest },
  ref,
) {
  return (
    <MenuPrimitive.Item
      ref={ref}
      className={cn(
        itemClass,
        description && "h-auto py-1.5",
        destructive && "text-danger-text data-highlighted:bg-danger-soft",
        className,
      )}
      {...rest}
    >
      {icon ? (
        <span
          className={cn(
            "flex size-4 items-center justify-center text-ink-3 [&_svg]:size-4",
            destructive && "text-danger-text",
          )}
        >
          {icon}
        </span>
      ) : null}
      <span className="flex min-w-0 flex-1 flex-col leading-tight">
        <span className="truncate">{children}</span>
        {description ? (
          <span className="mt-0.5 truncate text-2xs text-ink-3">{description}</span>
        ) : null}
      </span>
      {shortcut ? (
        <Shortcut
          shortcut={shortcut}
          size="sm"
          className="ml-3 border-transparent bg-transparent px-0"
        />
      ) : null}
    </MenuPrimitive.Item>
  );
});

export interface DropdownMenuCheckboxItemProps extends ComponentPropsWithoutRef<
  typeof MenuPrimitive.CheckboxItem
> {
  shortcut?: string;
}

export const DropdownMenuCheckboxItem = forwardRef<
  ComponentRef<typeof MenuPrimitive.CheckboxItem>,
  DropdownMenuCheckboxItemProps
>(function DropdownMenuCheckboxItem({ className, children, shortcut, ...rest }, ref) {
  return (
    <MenuPrimitive.CheckboxItem ref={ref} className={cn(itemClass, "pl-7", className)} {...rest}>
      <span className="absolute left-2 flex size-3.5 items-center justify-center rounded-xs border border-border-strong bg-surface [&:has([data-state=checked])]:border-accent [&:has([data-state=checked])]:bg-accent">
        <MenuPrimitive.ItemIndicator>
          <Check className="size-2.5 text-accent-ink" strokeWidth={3} aria-hidden="true" />
        </MenuPrimitive.ItemIndicator>
      </span>
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {shortcut ? (
        <Shortcut
          shortcut={shortcut}
          size="sm"
          className="ml-3 border-transparent bg-transparent px-0"
        />
      ) : null}
    </MenuPrimitive.CheckboxItem>
  );
});

export type DropdownMenuRadioItemProps = ComponentPropsWithoutRef<typeof MenuPrimitive.RadioItem>;

export const DropdownMenuRadioItem = forwardRef<
  ComponentRef<typeof MenuPrimitive.RadioItem>,
  DropdownMenuRadioItemProps
>(function DropdownMenuRadioItem({ className, children, ...rest }, ref) {
  return (
    <MenuPrimitive.RadioItem ref={ref} className={cn(itemClass, "pl-7", className)} {...rest}>
      <span className="absolute left-2 flex size-3.5 items-center justify-center">
        <MenuPrimitive.ItemIndicator>
          <Circle className="size-2 fill-accent text-accent" aria-hidden="true" />
        </MenuPrimitive.ItemIndicator>
      </span>
      <span className="min-w-0 flex-1 truncate">{children}</span>
    </MenuPrimitive.RadioItem>
  );
});

export interface DropdownMenuSubTriggerProps extends ComponentPropsWithoutRef<
  typeof MenuPrimitive.SubTrigger
> {
  icon?: ReactNode;
}

export const DropdownMenuSubTrigger = forwardRef<
  ComponentRef<typeof MenuPrimitive.SubTrigger>,
  DropdownMenuSubTriggerProps
>(function DropdownMenuSubTrigger({ className, icon, children, ...rest }, ref) {
  return (
    <MenuPrimitive.SubTrigger
      ref={ref}
      className={cn(itemClass, "data-[state=open]:bg-surface-3", className)}
      {...rest}
    >
      {icon ? (
        <span className="flex size-4 items-center justify-center text-ink-3 [&_svg]:size-4">
          {icon}
        </span>
      ) : null}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      <ChevronRight className="ml-2 size-3.5 text-ink-3" strokeWidth={1.75} aria-hidden="true" />
    </MenuPrimitive.SubTrigger>
  );
});

export type DropdownMenuLabelProps = ComponentPropsWithoutRef<typeof MenuPrimitive.Label>;

export const DropdownMenuLabel = forwardRef<
  ComponentRef<typeof MenuPrimitive.Label>,
  DropdownMenuLabelProps
>(function DropdownMenuLabel({ className, ...rest }, ref) {
  return (
    <MenuPrimitive.Label
      ref={ref}
      className={cn("text-eyebrow px-2 pb-1 pt-1.5", className)}
      {...rest}
    />
  );
});

export type DropdownMenuSeparatorProps = ComponentPropsWithoutRef<typeof MenuPrimitive.Separator>;

export const DropdownMenuSeparator = forwardRef<
  ComponentRef<typeof MenuPrimitive.Separator>,
  DropdownMenuSeparatorProps
>(function DropdownMenuSeparator({ className, ...rest }, ref) {
  return (
    <MenuPrimitive.Separator
      ref={ref}
      className={cn("-mx-1 my-1 h-px bg-border", className)}
      {...rest}
    />
  );
});

export type DropdownMenuShortcutProps = HTMLAttributes<HTMLSpanElement>;

/** Free-form trailing text for an item when `shortcut` is not a key combo. */
export function DropdownMenuShortcut({ className, ...rest }: DropdownMenuShortcutProps) {
  return (
    <span
      className={cn("ml-auto pl-3 font-mono text-2xs text-ink-3 tabular", className)}
      {...rest}
    />
  );
}
