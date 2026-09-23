import {
  createContext,
  forwardRef,
  useContext,
  useId,
  type ComponentPropsWithoutRef,
  type ComponentRef,
  type ReactNode,
} from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { motion, useReducedMotion } from "motion/react";
import { cn } from "@/lib/cn";
import { useControllableState } from "./useControllableState";

interface TabsContextValue {
  value: string | undefined;
  layoutId: string;
  size: "sm" | "md";
}

const TabsContext = createContext<TabsContextValue>({ value: undefined, layoutId: "", size: "md" });

export interface TabsProps extends Omit<
  ComponentPropsWithoutRef<typeof TabsPrimitive.Root>,
  "value" | "defaultValue" | "onValueChange"
> {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  size?: "sm" | "md";
}

/**
 * Underline tabs. The accent underline slides between triggers (a shared
 * layout animation, disabled under reduced motion). Triggers accept a
 * `count` or `badge`.
 */
export const Tabs = forwardRef<ComponentRef<typeof TabsPrimitive.Root>, TabsProps>(function Tabs(
  { value, defaultValue, onValueChange, size = "md", className, ...rest },
  ref,
) {
  const [current, setCurrent] = useControllableState<string | undefined>(
    value,
    defaultValue,
    (v) => {
      if (v !== undefined) onValueChange?.(v);
    },
  );
  const layoutId = useId();
  return (
    <TabsContext.Provider value={{ value: current, layoutId, size }}>
      <TabsPrimitive.Root
        ref={ref}
        value={current}
        onValueChange={setCurrent}
        className={cn("flex min-w-0 flex-col", className)}
        {...rest}
      />
    </TabsContext.Provider>
  );
});

export type TabsListProps = ComponentPropsWithoutRef<typeof TabsPrimitive.List>;

export const TabsList = forwardRef<ComponentRef<typeof TabsPrimitive.List>, TabsListProps>(
  function TabsList({ className, ...rest }, ref) {
    const { size } = useContext(TabsContext);
    return (
      <TabsPrimitive.List
        ref={ref}
        className={cn(
          "relative flex shrink-0 items-end gap-4 overflow-x-auto border-b border-border",
          size === "sm" ? "h-7" : "h-8",
          className,
        )}
        {...rest}
      />
    );
  },
);

export interface TabsTriggerProps extends ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger> {
  /** Mono count rendered after the label. */
  count?: number;
  /** Any node rendered after the label (a Badge, a StatusChip). */
  badge?: ReactNode;
  icon?: ReactNode;
}

export const TabsTrigger = forwardRef<ComponentRef<typeof TabsPrimitive.Trigger>, TabsTriggerProps>(
  function TabsTrigger({ className, count, badge, icon, children, value, ...rest }, ref) {
    const { value: active, layoutId, size } = useContext(TabsContext);
    const reduced = useReducedMotion();
    const isActive = active === value;
    return (
      <TabsPrimitive.Trigger
        ref={ref}
        value={value}
        className={cn(
          "group relative flex h-full shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap px-0.5 font-medium text-ink-3 outline-none",
          "transition-colors duration-(--dur-fast) ease-(--ease-out) hover:text-ink data-[state=active]:text-ink",
          "disabled:cursor-not-allowed disabled:opacity-50 focus-visible:rounded-xs",
          size === "sm" ? "text-2xs" : "text-xs",
          "[&_svg]:size-3.5 [&_svg]:shrink-0 [&_svg]:text-ink-3 data-[state=active]:[&_svg]:text-ink-2",
          className,
        )}
        {...rest}
      >
        {icon}
        {children}
        {count !== undefined ? (
          <span className="font-mono text-2xs font-normal text-ink-3 tabular group-data-[state=active]:text-ink-2">
            {count}
          </span>
        ) : null}
        {badge}
        {isActive ? (
          <motion.span
            aria-hidden="true"
            layoutId={reduced ? undefined : layoutId}
            transition={{ type: "spring", stiffness: 500, damping: 40, mass: 0.6 }}
            className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-accent"
          />
        ) : null}
      </TabsPrimitive.Trigger>
    );
  },
);

export type TabsContentProps = ComponentPropsWithoutRef<typeof TabsPrimitive.Content>;

export const TabsContent = forwardRef<ComponentRef<typeof TabsPrimitive.Content>, TabsContentProps>(
  function TabsContent({ className, ...rest }, ref) {
    return (
      <TabsPrimitive.Content
        ref={ref}
        className={cn("min-w-0 outline-none focus-visible:rounded-xs", className)}
        {...rest}
      />
    );
  },
);
