import { forwardRef, type HTMLAttributes } from "react";
import { cn } from "@/lib/cn";
import { Tooltip } from "@/primitives";

export type PortTypeFamily =
  "decision" | "string" | "number" | "boolean" | "object" | "array" | "message" | "any";

/**
 * Maps a port type (a JSON Schema `type`, a named type such as "decision" or
 * "message", or a generic like "string[]" / "array<message>") to its colour family.
 */
export function portTypeFamily(type: string): PortTypeFamily {
  const t = type.trim().toLowerCase();
  if (t.length === 0 || t === "any" || t === "unknown" || t === "*") return "any";
  if (t.endsWith("[]") || t.startsWith("array") || t.startsWith("list")) return "array";
  if (t.startsWith("decision")) return "decision";
  if (t.startsWith("message") || t.startsWith("chat")) return "message";
  switch (t) {
    case "string":
    case "text":
    case "str":
      return "string";
    case "number":
    case "integer":
    case "int":
    case "float":
    case "double":
    case "score":
    case "probability":
      return "number";
    case "boolean":
    case "bool":
      return "boolean";
    case "object":
    case "record":
    case "map":
    case "json":
      return "object";
    case "null":
    case "void":
      return "any";
    default:
      return "object";
  }
}

const FAMILY_CLASS: Record<PortTypeFamily, string> = {
  decision: "text-cat-decision [--chip:var(--cat-decision)]",
  string: "text-cat-data [--chip:var(--cat-data)]",
  number: "text-cat-state [--chip:var(--cat-state)]",
  boolean: "text-cat-human [--chip:var(--cat-human)]",
  object: "text-cat-tool [--chip:var(--cat-tool)]",
  array: "text-cat-agent [--chip:var(--cat-agent)]",
  message: "text-cat-generation [--chip:var(--cat-generation)]",
  any: "text-ink-3 [--chip:var(--ink-3)]",
};

export interface PortTypeLabelProps extends Omit<HTMLAttributes<HTMLSpanElement>, "children"> {
  /** The `PortView.type` string. */
  type: string;
  size?: "sm" | "md";
  /** Bare mono text without the tinted chip. */
  plain?: boolean;
  /** Marks the port as required with a trailing dot. */
  required?: boolean;
}

/**
 * Mono chip naming a port's type, tinted by its family (decision, string,
 * number, boolean, object, array, message, any). The tint is a 12% mix of the
 * family hue so it never competes with status colours.
 */
export const PortTypeLabel = forwardRef<HTMLSpanElement, PortTypeLabelProps>(function PortTypeLabel(
  { type, size = "md", plain = false, required = false, className, ...rest },
  ref,
) {
  const family = portTypeFamily(type);
  const chip = (
    <span
      ref={ref}
      data-family={family}
      className={cn(
        "inline-flex shrink-0 items-center gap-1 whitespace-nowrap font-mono leading-none tabular",
        FAMILY_CLASS[family],
        !plain && "rounded-xs bg-[color-mix(in_srgb,var(--chip)_12%,transparent)]",
        !plain && (size === "sm" ? "h-4 px-1 text-2xs" : "h-[18px] px-1.5 text-2xs"),
        plain && "text-2xs",
        className,
      )}
      {...rest}
    >
      {type}
      {required ? (
        <>
          <span aria-hidden="true" className="size-1 rounded-full bg-current opacity-70" />
          <span className="sr-only">required</span>
        </>
      ) : null}
    </span>
  );
  // The required dot is explained on hover; assistive tech reads the sr-only "required".
  return required ? <Tooltip content={`${type} (required)`}>{chip}</Tooltip> : chip;
});
