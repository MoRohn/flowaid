import {
  createContext,
  forwardRef,
  useContext,
  useId,
  type HTMLAttributes,
  type ReactNode,
} from "react";
import { AlertCircle } from "lucide-react";
import { cn } from "@/lib/cn";
import { Label } from "./Label";

export interface FieldContextValue {
  /** Id the control should use so the label points at it. */
  id: string;
  /** Space-separated ids of the hint/error nodes to reference via aria-describedby. */
  describedBy?: string;
  invalid: boolean;
  disabled: boolean;
  required: boolean;
}

const FieldContext = createContext<FieldContextValue | null>(null);

/** Reads the enclosing FieldRow, if any. Controls use it to wire id / aria-describedby / aria-invalid automatically. */
export function useFieldContext(): FieldContextValue | null {
  return useContext(FieldContext);
}

export interface FieldControlAttributes {
  id?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
  "aria-required"?: boolean;
  disabled?: boolean;
}

/**
 * Merges explicit control props with the enclosing field's wiring. Explicit
 * props win; the field only fills gaps.
 */
export function useFieldControl(own: FieldControlAttributes): FieldControlAttributes {
  const field = useFieldContext();
  if (!field) return own;
  return {
    id: own.id ?? field.id,
    "aria-describedby":
      [own["aria-describedby"], field.describedBy].filter(Boolean).join(" ") || undefined,
    "aria-invalid": own["aria-invalid"] ?? (field.invalid || undefined),
    "aria-required": own["aria-required"] ?? (field.required || undefined),
    disabled: own.disabled ?? (field.disabled || undefined),
  };
}

export type FieldHintProps = HTMLAttributes<HTMLParagraphElement>;

/** Secondary guidance under a control. */
export const FieldHint = forwardRef<HTMLParagraphElement, FieldHintProps>(function FieldHint(
  { className, ...rest },
  ref,
) {
  return <p ref={ref} className={cn("text-xs leading-normal text-ink-3", className)} {...rest} />;
});

export type FieldErrorProps = HTMLAttributes<HTMLParagraphElement>;

/** Validation message. Announced politely; renders nothing when empty. */
export const FieldError = forwardRef<HTMLParagraphElement, FieldErrorProps>(function FieldError(
  { className, children, ...rest },
  ref,
) {
  if (children === null || children === undefined || children === false || children === "")
    return null;
  return (
    <p
      ref={ref}
      role="alert"
      className={cn("flex items-start gap-1 text-xs leading-normal text-danger-text", className)}
      {...rest}
    >
      <AlertCircle className="mt-0.5 size-3.5 shrink-0" strokeWidth={1.75} aria-hidden="true" />
      <span>{children}</span>
    </p>
  );
});

export interface FieldRowProps extends Omit<HTMLAttributes<HTMLDivElement>, "children"> {
  label?: ReactNode;
  /** Explicit id for the control; generated when omitted. */
  htmlFor?: string;
  hint?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  optional?: boolean;
  disabled?: boolean;
  /** stacked: label above control. row: label in a left column (collapses to stacked below 320px containers). */
  layout?: "stacked" | "row";
  /** Width of the label column in row layout. */
  labelWidth?: number;
  /** Extra content right of the label (a badge, a help icon). */
  labelAddon?: ReactNode;
  /** Vertically centre the label with a single-line control (switch, select). */
  align?: "start" | "center";
  children: ReactNode;
}

/**
 * Label + control + hint + error in one consistent layout. Wraps children in
 * a field context so any primitive control picks up the id, description and
 * invalid state without extra props.
 */
export const FieldRow = forwardRef<HTMLDivElement, FieldRowProps>(function FieldRow(
  {
    label,
    htmlFor,
    hint,
    error,
    required = false,
    optional = false,
    disabled = false,
    layout = "stacked",
    labelWidth = 120,
    labelAddon,
    align = "start",
    className,
    children,
    ...rest
  },
  ref,
) {
  const generated = useId();
  const id = htmlFor ?? `field-${generated}`;
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [errorId, hintId].filter(Boolean).join(" ") || undefined;
  const invalid = Boolean(error);

  const labelNode = label ? (
    <div
      className={cn(
        "flex min-w-0 items-center gap-1.5",
        layout === "row" && (align === "center" ? "h-7" : "min-h-7"),
      )}
    >
      <Label htmlFor={id} required={required} optional={optional} disabled={disabled}>
        {label}
      </Label>
      {labelAddon}
    </div>
  ) : null;

  const controlNode = (
    <div className="flex min-w-0 flex-col gap-1.5">
      {children}
      <FieldError id={errorId}>{error}</FieldError>
      {hint ? <FieldHint id={hintId}>{hint}</FieldHint> : null}
    </div>
  );

  return (
    <FieldContext.Provider value={{ id, describedBy, invalid, disabled, required }}>
      <div
        ref={ref}
        data-layout={layout}
        data-invalid={invalid || undefined}
        className={cn("@container min-w-0", className)}
        {...rest}
      >
        {layout === "row" ? (
          <div
            className="grid grid-cols-1 gap-x-3 gap-y-1.5 @xs:grid-cols-[var(--label-w)_minmax(0,1fr)]"
            style={{ "--label-w": `${labelWidth}px` }}
          >
            {labelNode}
            {controlNode}
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            {labelNode}
            {controlNode}
          </div>
        )}
      </div>
    </FieldContext.Provider>
  );
});
