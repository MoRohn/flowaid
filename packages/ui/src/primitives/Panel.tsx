import { forwardRef, type HTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/cn";

export interface PanelProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  title?: ReactNode;
  /** Mono/eyebrow text after the title (a count, a kind). */
  meta?: ReactNode;
  icon?: ReactNode;
  /** Right-aligned controls in the header. */
  toolbar?: ReactNode;
  footer?: ReactNode;
  /** Apply 12px padding to the body (off for tables and lists). */
  padded?: boolean;
  /** Body scrolls inside the panel instead of growing it. */
  scroll?: boolean;
  /** Borderless variant for panels that sit inside another surface. */
  flush?: boolean;
  bodyClassName?: string;
}

/**
 * Titled panel with a 36px header and optional toolbar. Fills its parent as a
 * flex column; the body is the flexible part, so panels stack inside
 * resizable layouts without extra wrappers.
 */
export const Panel = forwardRef<HTMLDivElement, PanelProps>(function Panel(
  {
    title,
    meta,
    icon,
    toolbar,
    footer,
    padded = true,
    scroll = true,
    flush = false,
    bodyClassName,
    className,
    children,
    ...rest
  },
  ref,
) {
  const hasHeader = title !== undefined || toolbar !== undefined || icon !== undefined;
  return (
    <section
      ref={ref}
      className={cn(
        "flex min-h-0 min-w-0 flex-col bg-surface text-ink",
        flush ? "" : "rounded-md border border-border shadow-1",
        className,
      )}
      {...rest}
    >
      {hasHeader ? (
        <header className="flex h-9 shrink-0 items-center gap-2 border-b border-border px-3">
          {icon ? (
            <span className="flex shrink-0 items-center text-ink-3 [&_svg]:size-4">{icon}</span>
          ) : null}
          {title !== undefined ? (
            <h2 className="min-w-0 truncate text-xs font-medium text-ink">{title}</h2>
          ) : null}
          {meta !== undefined ? (
            <span className="shrink-0 font-mono text-2xs text-ink-3 tabular">{meta}</span>
          ) : null}
          {toolbar ? (
            <div className="ml-auto flex shrink-0 items-center gap-1">{toolbar}</div>
          ) : null}
        </header>
      ) : null}
      <div
        className={cn(
          "min-h-0 min-w-0 flex-1",
          scroll && "overflow-auto",
          padded && "p-3",
          bodyClassName,
        )}
      >
        {children}
      </div>
      {footer ? (
        <footer className="flex shrink-0 items-center gap-2 border-t border-border bg-surface-2 px-3 py-2 text-xs text-ink-2">
          {footer}
        </footer>
      ) : null}
    </section>
  );
});
