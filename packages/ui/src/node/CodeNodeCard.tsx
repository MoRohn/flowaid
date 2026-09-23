import { forwardRef } from "react";
import { Badge, Tooltip } from "@/primitives";
import { NodeCard, type NodeCardBaseProps } from "./NodeCard";
import { metaValue, metaWithout } from "./nodeUtils";

export interface CodeNodeCardProps extends NodeCardBaseProps {
  /** Source; only its first non-empty line is shown. */
  code?: string;
  /** Language chip; defaults to the "language" meta entry. */
  language?: string;
}

/** First non-empty line of a snippet, trimmed. */
export function firstCodeLine(code: string | undefined): string | undefined {
  if (!code) return undefined;
  for (const line of code.split(/\r?\n/)) {
    const t = line.trim();
    if (t) return t;
  }
  return undefined;
}

const LANGUAGE_SHORT: Record<string, string> = {
  javascript: "js",
  typescript: "ts",
  python: "py",
};

/** Inline code node: language chip and the first line of the snippet in mono. */
export const CodeNodeCard = forwardRef<HTMLDivElement, CodeNodeCardProps>(function CodeNodeCard(
  { node, run, code, language, ...state },
  ref,
) {
  const lang = (language ?? metaValue(node, "language", "lang") ?? "javascript").toLowerCase();
  const line = firstCodeLine(code ?? metaValue(node, "code"));
  return (
    <NodeCard
      ref={ref}
      node={node}
      run={run}
      kindLabel="code"
      meta={metaWithout(node, "language", "lang", "code")}
      {...state}
    >
      <div className="flex items-center gap-1.5">
        <Badge tone="neutral" size="sm" mono data-language={lang}>
          {LANGUAGE_SHORT[lang] ?? lang}
        </Badge>
        {line ? (
          <Tooltip content={<span className="font-mono">{line}</span>}>
            <code className="min-w-0 flex-1 truncate font-mono text-2xs text-ink-2">{line}</code>
          </Tooltip>
        ) : (
          <span className="text-2xs text-ink-3">No code yet</span>
        )}
      </div>
    </NodeCard>
  );
});
