import { forwardRef } from "react";
import { Badge, type BadgeProps } from "@/primitives";
import { ToolNodeCard, type ToolNodeCardProps } from "./ToolNodeCard";
import { metaValue } from "./nodeUtils";

export interface HttpNodeCardProps extends Omit<ToolNodeCardProps, "description" | "kindLabel"> {
  /** HTTP method; defaults to the "method" meta entry, then GET. */
  method?: string;
  /** Request path; defaults to the "path" meta entry, then the description. */
  path?: string;
}

/** Badge tone per method: GET reads as ink, POST as the accent, DELETE as danger. */
export function httpMethodTone(method: string): NonNullable<BadgeProps["tone"]> {
  switch (method.toUpperCase()) {
    case "POST":
      return "accent";
    case "DELETE":
      return "danger";
    default:
      return "neutral";
  }
}

/** HTTP request node: a method badge and the request path in place of the description. */
export const HttpNodeCard = forwardRef<HTMLDivElement, HttpNodeCardProps>(function HttpNodeCard(
  { node, method, path, ...rest },
  ref,
) {
  const m = (method ?? metaValue(node, "method") ?? "GET").toUpperCase();
  const p = path ?? metaValue(node, "path") ?? node.description ?? "";
  return (
    <ToolNodeCard
      ref={ref}
      node={node}
      kindLabel="http"
      description={
        <span className="inline-flex max-w-full items-center gap-1.5 align-top">
          <Badge tone={httpMethodTone(m)} size="sm" mono data-method={m}>
            {m}
          </Badge>
          <span className="min-w-0 truncate font-mono text-2xs text-ink-2">{p}</span>
        </span>
      }
      {...rest}
    />
  );
});
