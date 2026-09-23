import { forwardRef, type HTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { LogoMark, LogoWordmark } from "@/primitives";

export interface ReviewLayoutProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  /** Page title next to the logo. */
  title: ReactNode;
  /** Mono meta at the right of the bar (an expiry, a request id). */
  meta?: ReactNode;
  /** Right-aligned bar content (a StatusChip, a language menu). */
  actions?: ReactNode;
  /** Column width in px (default 640). */
  width?: number;
  /** Replace the "Powered by FlowAId" footer. */
  footer?: ReactNode;
  children: ReactNode;
}

/**
 * Minimal chrome for external reviewers who open an approval link: a 44px
 * bar with the mark and the page title, one centred column, and a
 * "Powered by FlowAId" footer. No nav, no shortcuts, nothing to learn.
 */
export const ReviewLayout = forwardRef<HTMLDivElement, ReviewLayoutProps>(function ReviewLayout(
  { title, meta, actions, width = 640, footer, children, className, ...rest },
  ref,
) {
  return (
    <div
      ref={ref}
      className={cn("flex min-h-full w-full flex-col bg-canvas text-ink", className)}
      {...rest}
    >
      <header className="flex h-11 shrink-0 items-center gap-3 border-b border-border bg-surface px-4">
        <LogoMark size={20} title="FlowAId" className="text-ink" />
        <h1 className="min-w-0 truncate text-sm font-semibold tracking-tight">{title}</h1>
        <div className="ml-auto flex shrink-0 items-center gap-3">
          {meta ? <span className="font-mono text-2xs text-ink-3 tabular">{meta}</span> : null}
          {actions}
        </div>
      </header>
      <main className="flex flex-1 justify-center px-4 py-8 sm:py-12">
        <div className="flex w-full min-w-0 flex-col gap-4" style={{ maxWidth: width }}>
          {children}
        </div>
      </main>
      <footer className="flex h-11 shrink-0 items-center justify-center gap-1.5 border-t border-border text-2xs text-ink-3">
        {footer ?? (
          <>
            <span>Powered by</span>
            <LogoWordmark height={11} title="FlowAId" className="text-ink-2" />
          </>
        )}
      </footer>
    </div>
  );
});
