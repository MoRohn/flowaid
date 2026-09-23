import { forwardRef } from "react";
import { Search } from "lucide-react";
import { NodeCard, type NodeCardBaseProps, type NodeMetaItem } from "./NodeCard";
import { isRecord, metaValue, metaWithout, numberField } from "./nodeUtils";

export interface RetrievalNodeCardProps extends NodeCardBaseProps {
  /** Index or collection name; defaults to the "index" meta entry. */
  index?: string;
  /** Results requested; defaults to the "top_k"/"k" meta entry. */
  topK?: number;
  /** Results returned; defaults to the run output. */
  hits?: number;
}

/** Retrieval node: which index it queries, how many results it asks for and how many came back. */
export const RetrievalNodeCard = forwardRef<HTMLDivElement, RetrievalNodeCardProps>(
  function RetrievalNodeCard({ node, run, index, topK, hits, ...state }, ref) {
    const name = index ?? metaValue(node, "index", "collection");
    const kRaw = topK ?? Number(metaValue(node, "top_k", "topk", "k"));
    const k = Number.isFinite(kRaw) ? kRaw : undefined;
    const output = run?.output;
    const fromOutput =
      numberField(output, "hits") ??
      (isRecord(output) && Array.isArray(output.results) ? output.results.length : undefined);
    const found = hits ?? fromOutput;
    const meta: NodeMetaItem[] = [
      ...metaWithout(node, "index", "collection", "top_k", "topk", "k"),
    ];
    if (k !== undefined) meta.push({ label: "top-k", value: String(k) });
    if (found !== undefined)
      meta.push({ label: "hits", value: String(found), tone: found === 0 ? "danger" : "default" });
    return (
      <NodeCard ref={ref} node={node} run={run} kindLabel="retrieval" meta={meta} {...state}>
        {name ? (
          <div className="flex items-center gap-1.5">
            <Search
              className="size-3.5 shrink-0 text-ink-3"
              strokeWidth={1.75}
              aria-hidden="true"
            />
            <span
              className="min-w-0 flex-1 truncate font-mono text-2xs text-ink-2"
              data-index={name}
            >
              {name}
            </span>
          </div>
        ) : null}
      </NodeCard>
    );
  },
);
