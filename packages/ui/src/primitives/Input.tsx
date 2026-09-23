import { forwardRef, type InputHTMLAttributes, type ReactNode } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";
import { useFieldControl } from "./Field";

export const inputVariants = cva(
  [
    "peer w-full min-w-0 rounded-sm border border-border bg-surface text-ink placeholder:text-ink-3",
    "transition-[border-color,box-shadow,background-color] duration-(--dur-fast) ease-(--ease-out)",
    "hover:border-border-strong focus-visible:border-accent",
    "disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-ink-4 disabled:placeholder:text-ink-4",
    "aria-invalid:border-danger aria-invalid:focus-visible:border-danger read-only:bg-surface-2",
  ],
  {
    variants: {
      size: {
        sm: "h-6 px-1.5 text-xs",
        md: "h-7 px-2 text-sm",
        lg: "h-8 px-2.5 text-sm",
      },
      mono: { true: "font-mono text-xs tabular", false: "" },
    },
    defaultVariants: { size: "md", mono: false },
  },
);

export interface InputProps
  extends
    Omit<InputHTMLAttributes<HTMLInputElement>, "size">,
    Omit<VariantProps<typeof inputVariants>, "mono"> {
  /** Use the mono face (identifiers, numbers, expressions). */
  mono?: boolean;
  /** Marks the control invalid (also inferred from an enclosing FieldRow error). */
  invalid?: boolean;
  /** Content rendered inside the field at the start (an icon, a prefix). */
  leading?: ReactNode;
  /** Content rendered inside the field at the end (a unit, a shortcut, a button). */
  trailing?: ReactNode;
  /** Class for the wrapper that appears when `leading`/`trailing` are used. */
  wrapperClassName?: string;
}

/**
 * Single-line text input. 28px by default, 1px border, accent border on focus
 * with the global focus ring. Leading/trailing slots overlay the field edges.
 */
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  {
    className,
    size,
    mono = false,
    invalid,
    leading,
    trailing,
    wrapperClassName,
    id,
    disabled,
    ...rest
  },
  ref,
) {
  const field = useFieldControl({
    id,
    disabled,
    "aria-invalid": invalid,
    "aria-describedby": rest["aria-describedby"],
  });
  const input = (
    <input
      ref={ref}
      {...rest}
      id={field.id}
      disabled={field.disabled}
      aria-invalid={field["aria-invalid"]}
      aria-describedby={field["aria-describedby"]}
      aria-required={field["aria-required"]}
      className={cn(
        inputVariants({ size, mono }),
        leading && "pl-7",
        trailing && "pr-7",
        className,
      )}
    />
  );
  if (!leading && !trailing) return input;
  return (
    <div className={cn("relative flex w-full min-w-0 items-center", wrapperClassName)}>
      {leading ? (
        <span className="pointer-events-none absolute left-0 flex h-full w-7 items-center justify-center text-ink-3 [&_svg]:size-4">
          {leading}
        </span>
      ) : null}
      {input}
      {trailing ? (
        <span className="absolute right-0 flex h-full items-center justify-center pr-1.5 text-ink-3 [&_svg]:size-4">
          {trailing}
        </span>
      ) : null}
    </div>
  );
});
