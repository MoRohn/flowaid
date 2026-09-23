import {
  forwardRef,
  useEffect,
  useRef,
  useState,
  type HTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { ChevronRight, Pencil } from "lucide-react";
import { cn } from "@/lib/cn";
import { Tooltip } from "@/primitives";

export interface BreadcrumbItem {
  id: string;
  label: string;
  href?: string;
  icon?: ReactNode;
  onClick?: () => void;
}

export interface BreadcrumbsProps extends Omit<HTMLAttributes<HTMLElement>, "onChange"> {
  items: BreadcrumbItem[];
  /** Enables inline rename of the last crumb: double-click, Enter or the pencil edits it. */
  onRename?: (name: string) => void;
  /** Validate before commit; return a message to block the rename. */
  validateName?: (name: string) => string | undefined;
  /** Start in edit mode (controlled by the parent, e.g. right after "New workflow"). */
  editing?: boolean;
  onEditingChange?: (editing: boolean) => void;
}

/**
 * Path across the top bar: "workspace / workflows / name". Ancestors are links
 * or buttons in ink-3; the current item is ink and, with `onRename`, editable
 * in place with a mono-width input that commits on Enter and cancels on Escape.
 */
export const Breadcrumbs = forwardRef<HTMLElement, BreadcrumbsProps>(function Breadcrumbs(
  { items, onRename, validateName, editing: editingProp, onEditingChange, className, ...rest },
  ref,
) {
  const [editingState, setEditingState] = useState(false);
  const editing = editingProp ?? editingState;
  const setEditing = (next: boolean) => {
    setEditingState(next);
    onEditingChange?.(next);
  };
  const last = items[items.length - 1];
  const [draft, setDraft] = useState(last?.label ?? "");
  const [error, setError] = useState<string | undefined>(undefined);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      setDraft(last?.label ?? "");
      setError(undefined);
      const el = inputRef.current;
      if (el) {
        el.focus();
        el.select();
      }
    }
  }, [editing, last?.label]);

  const commit = () => {
    const name = draft.trim();
    if (!last) return;
    if (name.length === 0) {
      setError("Name cannot be empty");
      return;
    }
    const problem = validateName?.(name);
    if (problem) {
      setError(problem);
      return;
    }
    setEditing(false);
    if (name !== last.label) onRename?.(name);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      commit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      setEditing(false);
    }
  };

  return (
    <nav
      ref={ref}
      aria-label="Breadcrumb"
      className={cn("flex min-w-0 items-center text-xs", className)}
      {...rest}
    >
      <ol className="flex min-w-0 items-center gap-0.5">
        {items.map((item, i) => {
          const isLast = i === items.length - 1;
          const crumbClass =
            "flex h-6 max-w-48 items-center gap-1.5 truncate rounded-xs px-1.5 transition-colors duration-(--dur-fast) [&_svg]:size-3.5 [&_svg]:shrink-0";
          let node: ReactNode;
          if (isLast) {
            node = editing ? (
              <span className="relative flex items-center">
                <input
                  ref={inputRef}
                  value={draft}
                  aria-label="Workflow name"
                  aria-invalid={error ? true : undefined}
                  onChange={(e) => {
                    setDraft(e.target.value);
                    setError(undefined);
                  }}
                  onKeyDown={onKeyDown}
                  onBlur={commit}
                  size={Math.max(8, draft.length + 1)}
                  className={cn(
                    "h-6 rounded-xs border bg-surface px-1.5 text-xs font-medium text-ink outline-none",
                    error ? "border-danger" : "border-accent",
                  )}
                />
                {error ? (
                  <span
                    role="alert"
                    className="absolute left-0 top-full z-10 mt-1 whitespace-nowrap rounded-xs bg-danger px-1.5 py-0.5 text-2xs font-medium text-accent-ink"
                  >
                    {error}
                  </span>
                ) : null}
              </span>
            ) : (
              <span className="group/crumb flex items-center gap-0.5">
                <span
                  aria-current="page"
                  tabIndex={onRename ? 0 : undefined}
                  role={onRename ? "button" : undefined}
                  onDoubleClick={onRename ? () => setEditing(true) : undefined}
                  onKeyDown={
                    onRename
                      ? (e) => {
                          if (e.key === "Enter" || e.key === "F2") {
                            e.preventDefault();
                            setEditing(true);
                          }
                        }
                      : undefined
                  }
                  className={cn(
                    crumbClass,
                    "font-medium text-ink",
                    onRename && "cursor-text hover:bg-surface-3",
                  )}
                >
                  {item.icon}
                  <span className="truncate">{item.label}</span>
                </span>
                {onRename ? (
                  <Tooltip content="Rename" shortcut="enter">
                    <button
                      type="button"
                      aria-label="Rename"
                      onClick={() => setEditing(true)}
                      className="flex size-5 items-center justify-center rounded-xs text-ink-3 opacity-0 transition-opacity duration-(--dur-fast) hover:bg-surface-3 hover:text-ink-2 focus-visible:opacity-100 group-hover/crumb:opacity-100"
                    >
                      <Pencil className="size-3" strokeWidth={1.75} aria-hidden="true" />
                    </button>
                  </Tooltip>
                ) : null}
              </span>
            );
          } else if (item.href) {
            node = (
              <a
                href={item.href}
                onClick={item.onClick}
                className={cn(crumbClass, "text-ink-3 hover:bg-surface-3 hover:text-ink")}
              >
                {item.icon}
                <span className="truncate">{item.label}</span>
              </a>
            );
          } else {
            node = (
              <button
                type="button"
                onClick={item.onClick}
                className={cn(crumbClass, "text-ink-3 hover:bg-surface-3 hover:text-ink")}
              >
                {item.icon}
                <span className="truncate">{item.label}</span>
              </button>
            );
          }
          return (
            <li key={item.id} className="flex min-w-0 items-center gap-0.5">
              {i > 0 ? (
                <ChevronRight
                  className="size-3 shrink-0 text-ink-3"
                  strokeWidth={1.75}
                  aria-hidden="true"
                />
              ) : null}
              {node}
            </li>
          );
        })}
      </ol>
    </nav>
  );
});
