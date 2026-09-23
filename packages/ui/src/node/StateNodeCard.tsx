import { forwardRef } from "react";
import { Database } from "lucide-react";
import { NodeCard, type NodeCardBaseProps, type NodeMetaItem } from "./NodeCard";
import { isRecord, metaValue, metaWithout, numberField } from "./nodeUtils";

export interface StateNodeCardProps extends NodeCardBaseProps {
  /** Memory kind (kv, conversation, checkpoint); defaults to the "memory" or "kind" meta entry. */
  memoryKind?: string;
  /** Number of keys held; defaults to the run output. */
  keysCount?: number;
}

/** Memory / state node: the store kind and how many keys it holds. */
export const StateNodeCard = forwardRef<HTMLDivElement, StateNodeCardProps>(function StateNodeCard(
  { node, run, memoryKind, keysCount, ...state },
  ref,
) {
  const kind = memoryKind ?? metaValue(node, "memory", "kind");
  const fromOutput =
    numberField(run?.output, "keys") ??
    (isRecord(run?.output) && isRecord(run.output.state)
      ? Object.keys(run.output.state).length
      : undefined);
  const metaKeys = Number(metaValue(node, "keys"));
  const keys = keysCount ?? fromOutput ?? (Number.isFinite(metaKeys) ? metaKeys : undefined);
  const meta: NodeMetaItem[] = [...metaWithout(node, "memory", "kind", "keys")];
  if (keys !== undefined) meta.push({ label: "keys", value: String(keys) });
  return (
    <NodeCard ref={ref} node={node} run={run} kindLabel="state" meta={meta} {...state}>
      {kind ? (
        <div className="flex items-center gap-1.5">
          <Database
            className="size-3.5 shrink-0 text-ink-3"
            strokeWidth={1.75}
            aria-hidden="true"
          />
          <span
            className="min-w-0 flex-1 truncate font-mono text-2xs text-ink-2"
            data-memory-kind={kind}
          >
            {kind}
          </span>
        </div>
      ) : null}
    </NodeCard>
  );
});
