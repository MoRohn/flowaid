import { forwardRef, type ReactNode } from "react";
import { KeyRound } from "lucide-react";
import { cn } from "@/lib/cn";
import { formatMs } from "@/lib/format";
import { Badge } from "@/primitives";
import { NodeCard, type NodeCardBaseProps } from "./NodeCard";
import { metaValue, metaWithout } from "./nodeUtils";

export interface ToolNodeCardProps extends NodeCardBaseProps {
  /** Replaces the description line (HTTP cards put the method and path here). */
  description?: ReactNode;
  kindLabel?: string;
  /** Credential name shown as a chip; defaults to the "credential" meta entry. */
  credential?: string;
}

/** Tone for an HTTP status code chip: 2xx ok, 4xx warn, 5xx danger. */
export function httpStatusTone(code: number): "ok" | "warn" | "danger" | "neutral" {
  if (code >= 500) return "danger";
  if (code >= 400) return "warn";
  if (code >= 200 && code < 300) return "ok";
  return "neutral";
}

const CODE_CLASS = {
  ok: "text-ok-text",
  warn: "text-warn-text",
  danger: "text-danger-text",
  neutral: "text-ink-3",
} as const;

/**
 * Tool call node (HTTP, MCP, OpenAPI). The purpose line names the tool, a
 * chip names the credential it runs with, and the footer carries the status
 * code next to the duration once it has been called.
 */
export const ToolNodeCard = forwardRef<HTMLDivElement, ToolNodeCardProps>(function ToolNodeCard(
  { node, run, description, kindLabel, credential, ...state },
  ref,
) {
  const toolName = metaValue(node, "tool");
  const cred = credential ?? metaValue(node, "credential");
  const call = run?.toolCall;
  const code = call?.statusCode;
  const duration = call?.durationMs ?? run?.durationMs;
  return (
    <NodeCard
      ref={ref}
      node={node}
      run={run}
      kindLabel={kindLabel}
      description={description ?? node.description ?? toolName}
      meta={metaWithout(node, "tool", "credential", "method", "path")}
      footerRight={
        code !== undefined || duration !== undefined ? (
          <span className="inline-flex items-center gap-1.5">
            {code !== undefined ? (
              <span
                className={cn("font-medium", CODE_CLASS[httpStatusTone(code)])}
                data-status-code={code}
              >
                {code}
              </span>
            ) : null}
            {duration !== undefined ? <span>{formatMs(duration)}</span> : null}
          </span>
        ) : undefined
      }
      {...state}
    >
      {cred ? (
        <Badge
          tone="outline"
          size="sm"
          mono
          icon={<KeyRound strokeWidth={1.75} aria-hidden="true" />}
        >
          {cred}
        </Badge>
      ) : null}
    </NodeCard>
  );
});
