import {
  createContext,
  forwardRef,
  useContext,
  type ComponentPropsWithoutRef,
  type ComponentRef,
} from "react";
import * as ToggleGroupPrimitive from "@radix-ui/react-toggle-group";
import { cn } from "@/lib/cn";
import { useFieldControl } from "./Field";

type ToggleSize = "sm" | "md";
interface ToggleContextValue {
  size: ToggleSize;
  fullWidth: boolean;
}
const ToggleContext = createContext<ToggleContextValue>({ size: "md", fullWidth: false });

export type ToggleGroupProps = ComponentPropsWithoutRef<typeof ToggleGroupPrimitive.Root> & {
  size?: ToggleSize;
  /** Stretch items to fill the width evenly. */
  fullWidth?: boolean;
};

/**
 * Segmented control (single or multiple selection). A bordered rail with
 * items that fill with surface-3 when pressed, matching the style guide.
 */
export const ToggleGroup = forwardRef<
  ComponentRef<typeof ToggleGroupPrimitive.Root>,
  ToggleGroupProps
>(function ToggleGroup(
  { className, size = "md", fullWidth = false, id, disabled, children, ...rest },
  ref,
) {
  const field = useFieldControl({ id, disabled, "aria-describedby": rest["aria-describedby"] });
  return (
    <ToggleContext.Provider value={{ size, fullWidth }}>
      <ToggleGroupPrimitive.Root
        ref={ref}
        {...rest}
        id={field.id}
        disabled={field.disabled}
        aria-describedby={field["aria-describedby"]}
        className={cn(
          "inline-flex max-w-full items-stretch self-start rounded-sm border border-border bg-surface p-0.5 shadow-1",
          size === "sm" ? "h-6 gap-px" : "h-7 gap-0.5",
          fullWidth && "flex w-full",
          className,
        )}
      >
        {children}
      </ToggleGroupPrimitive.Root>
    </ToggleContext.Provider>
  );
});

export type ToggleGroupItemProps = ComponentPropsWithoutRef<typeof ToggleGroupPrimitive.Item>;

export const ToggleGroupItem = forwardRef<
  ComponentRef<typeof ToggleGroupPrimitive.Item>,
  ToggleGroupItemProps
>(function ToggleGroupItem({ className, ...rest }, ref) {
  const { size, fullWidth } = useContext(ToggleContext);
  return (
    <ToggleGroupPrimitive.Item
      ref={ref}
      className={cn(
        "inline-flex cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-xs text-ink-2",
        fullWidth && "flex-1 basis-0",
        "transition-[background-color,color] duration-(--dur-fast) ease-(--ease-out)",
        "hover:text-ink data-[state=on]:bg-surface-3 data-[state=on]:font-medium data-[state=on]:text-ink",
        "disabled:cursor-not-allowed disabled:opacity-50 [&_svg]:shrink-0",
        size === "sm" ? "px-1.5 text-2xs [&_svg]:size-3.5" : "px-2 text-xs [&_svg]:size-4",
        className,
      )}
      {...rest}
    />
  );
});
