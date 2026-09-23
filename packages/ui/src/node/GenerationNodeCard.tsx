import { forwardRef } from "react";
import { formatCost, formatTokens } from "@/lib/format";
import { ProgressBar } from "@/primitives";
import { NodeCard, type NodeCardBaseProps, type NodeMetaItem } from "./NodeCard";
import { metaValue, metaWithout, runIsActive } from "./nodeUtils";

export interface GenerationStream {
  /** Output text received so far. */
  text: string;
  /** Output tokens received so far. */
  outputTokens: number;
}

export interface GenerationNodeCardProps extends NodeCardBaseProps {
  /** Live output while the node is running; the card shows a two-line preview and a token counter. */
  stream?: GenerationStream;
}

/**
 * Generative model node. Idle it shows the model and sampling settings;
 * while running it previews the streaming output with a live token counter;
 * completed it reports tokens and cost.
 */
export const GenerationNodeCard = forwardRef<HTMLDivElement, GenerationNodeCardProps>(
  function GenerationNodeCard({ node, run, stream, ...state }, ref) {
    const active = runIsActive(run);
    const model = node.provider ?? metaValue(node, "model");
    const temperature = metaValue(node, "temperature", "temp");
    const meta: NodeMetaItem[] = [];
    if (temperature !== undefined) meta.push({ label: "temp", value: temperature });
    meta.push(...metaWithout(node, "model", "temperature", "temp"));
    const usage = run?.usage;
    if (!active) {
      if (usage) {
        meta.push({
          label: "tok",
          value: `${formatTokens(usage.inputTokens)}→${formatTokens(usage.outputTokens)}`,
        });
      }
      if (run?.costUsd !== undefined) meta.push({ label: "cost", value: formatCost(run.costUsd) });
    }

    const preview = stream?.text.trim();
    return (
      <NodeCard
        ref={ref}
        node={node}
        run={run}
        kindLabel="generate"
        provider={model}
        meta={meta}
        footerRight={
          active && stream ? (
            <span
              className="inline-flex items-center gap-1 text-info-text"
              aria-live="polite"
              data-live-tokens={stream.outputTokens}
            >
              <span className="font-medium">{formatTokens(stream.outputTokens)}</span>
              <span className="text-ink-3">tok</span>
            </span>
          ) : undefined
        }
        {...state}
      >
        {active ? (
          preview ? (
            <p
              className="line-clamp-2 text-2xs leading-[15px] text-ink-2 [overflow-wrap:anywhere]"
              data-stream-preview="true"
            >
              {preview}
              <span className="fa-caret" aria-hidden="true" />
            </p>
          ) : (
            <ProgressBar label="Generating" />
          )
        ) : null}
      </NodeCard>
    );
  },
);
