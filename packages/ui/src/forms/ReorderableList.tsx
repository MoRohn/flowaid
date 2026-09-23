import { useId, type KeyboardEvent, type ReactNode } from "react";
import { Reorder, useDragControls, useReducedMotion } from "motion/react";
import { GripVertical } from "lucide-react";
import { cn } from "@/lib/cn";

export interface ReorderableListProps<T> {
  items: T[];
  /** Stable key per item. Keys must be unique. */
  keyOf: (item: T, index: number) => string;
  /** New order. `order[i]` is the previous index of the item now at `i`. */
  onReorder: (items: T[], order: number[]) => void;
  /** Row content. `handle` is the drag/keyboard grip to place inside the row. */
  renderItem: (item: T, index: number, handle: ReactNode) => ReactNode;
  disabled?: boolean;
  className?: string;
  itemClassName?: string;
  /** Accessible name for the list. */
  label?: string;
}

/** Moves `items[from]` to `to`, returning a new array. */
export function moveItem<T>(items: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || from >= items.length || to < 0 || to >= items.length) return items;
  const next = items.slice();
  const [moved] = next.splice(from, 1);
  if (moved === undefined) return items;
  next.splice(to, 0, moved);
  return next;
}

/** The index permutation produced by `moveItem`. */
export function moveOrder(length: number, from: number, to: number): number[] {
  return moveItem(
    Array.from({ length }, (_, i) => i),
    from,
    to,
  );
}

interface RowProps {
  id: string;
  index: number;
  count: number;
  disabled: boolean;
  className?: string;
  onMove: (from: number, to: number) => void;
  children: (handle: ReactNode) => ReactNode;
}

function ReorderableRow({ id, index, count, disabled, className, onMove, children }: RowProps) {
  const controls = useDragControls();
  const reduced = useReducedMotion();

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    let target: number | null = null;
    if (e.key === "ArrowUp") target = index - 1;
    else if (e.key === "ArrowDown") target = index + 1;
    else if (e.key === "Home") target = 0;
    else if (e.key === "End") target = count - 1;
    if (target === null) return;
    e.preventDefault();
    if (target !== index && target >= 0 && target < count) onMove(index, target);
  };

  const handle = (
    <button
      type="button"
      disabled={disabled}
      aria-label={`Reorder item ${index + 1} of ${count}. Use arrow keys to move.`}
      onPointerDown={(e) => {
        if (disabled) return;
        e.preventDefault();
        controls.start(e);
      }}
      onKeyDown={onKeyDown}
      className={cn(
        "flex h-7 w-5 shrink-0 cursor-grab touch-none items-center justify-center rounded-xs text-ink-3",
        "transition-colors duration-(--dur-fast) hover:bg-surface-3 hover:text-ink-2 active:cursor-grabbing",
        "disabled:cursor-not-allowed disabled:opacity-40",
      )}
    >
      <GripVertical className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
    </button>
  );

  return (
    <Reorder.Item
      value={id}
      dragListener={false}
      dragControls={controls}
      layout="position"
      transition={reduced ? { duration: 0 } : { type: "spring", stiffness: 500, damping: 40 }}
      whileDrag={{ zIndex: 1, boxShadow: "var(--shadow-2)", backgroundColor: "var(--surface)" }}
      className={cn("relative rounded-sm", className)}
    >
      {children(handle)}
    </Reorder.Item>
  );
}

/**
 * Vertical list with pointer drag-reorder (from a grip) and keyboard reorder
 * (arrow keys, Home and End on the grip). Layout moves animate unless the
 * person prefers reduced motion.
 */
export function ReorderableList<T>({
  items,
  keyOf,
  onReorder,
  renderItem,
  disabled = false,
  className,
  itemClassName,
  label,
}: ReorderableListProps<T>) {
  const listId = useId();
  const keys = items.map((item, i) => keyOf(item, i));
  const byKey = new Map(keys.map((k, i) => [k, items[i]] as const));

  const handleReorder = (nextKeys: string[]) => {
    const next: T[] = [];
    const order: number[] = [];
    for (const k of nextKeys) {
      const item = byKey.get(k);
      const index = keys.indexOf(k);
      if (item !== undefined && index !== -1) {
        next.push(item);
        order.push(index);
      }
    }
    if (next.length === items.length) onReorder(next, order);
  };

  return (
    <Reorder.Group
      axis="y"
      values={keys}
      onReorder={handleReorder}
      aria-label={label}
      id={listId}
      className={cn("m-0 flex list-none flex-col gap-1.5 p-0", className)}
    >
      {items.map((item, index) => {
        const key = keys[index] ?? String(index);
        return (
          <ReorderableRow
            key={key}
            id={key}
            index={index}
            count={items.length}
            disabled={disabled}
            className={itemClassName}
            onMove={(from, to) =>
              onReorder(moveItem(items, from, to), moveOrder(items.length, from, to))
            }
          >
            {(handle) => renderItem(item, index, handle)}
          </ReorderableRow>
        );
      })}
    </Reorder.Group>
  );
}
