import { forwardRef, type HTMLAttributes } from "react";
import { StickyNote } from "lucide-react";
import { cn } from "@/lib/cn";
import type { WorkflowNodeView } from "@/types";

export interface NoteCardProps extends Omit<HTMLAttributes<HTMLDivElement>, "children"> {
  node: Pick<WorkflowNodeView, "id" | "name" | "description">;
  selected?: boolean;
  dragging?: boolean;
}

/**
 * Canvas annotation (`kind: "note"`). The compiler drops notes, so the card
 * has no handles, no run state and no category: a title and the note text
 * (`node.description`) on a flat surface with a dashed border.
 */
export const NoteCard = forwardRef<HTMLDivElement, NoteCardProps>(function NoteCard(
  { node, selected = false, dragging = false, className, ...rest },
  ref,
) {
  return (
    <div
      ref={ref}
      className={cn(
        "fa-note flex w-[232px] flex-col gap-1.5 rounded-md border border-dashed border-border-strong bg-surface-2 px-2.5 py-2 text-ink-2",
        selected && "border-solid border-accent",
        className,
      )}
      data-kind="note"
      data-node-id={node.id}
      data-selected={selected ? "true" : "false"}
      data-dragging={dragging ? "true" : undefined}
      {...rest}
    >
      <div className="flex items-center gap-1.5">
        <StickyNote
          className="size-3.5 shrink-0 text-ink-3"
          strokeWidth={1.75}
          aria-hidden="true"
        />
        <span className="min-w-0 flex-1 truncate text-xs font-semibold text-ink">{node.name}</span>
      </div>
      {node.description ? (
        <p className="whitespace-pre-wrap text-xs leading-[17px] [overflow-wrap:anywhere]">
          {node.description}
        </p>
      ) : null}
    </div>
  );
});
