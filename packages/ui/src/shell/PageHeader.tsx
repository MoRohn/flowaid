import { forwardRef, type HTMLAttributes, type ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import { cn } from "@/lib/cn";
import { IconButton, Tabs, TabsList, TabsTrigger } from "@/primitives";

export interface PageHeaderTab {
  id: string;
  label: string;
  count?: number;
  icon?: ReactNode;
  disabled?: boolean;
}

export interface PageHeaderProps extends Omit<HTMLAttributes<HTMLElement>, "title"> {
  title: ReactNode;
  description?: ReactNode;
  /** Mono eyebrow above the title (a section, an id). */
  eyebrow?: ReactNode;
  /** Right-aligned actions; the primary button should be the last one. */
  actions?: ReactNode;
  /** A SearchInput or filter controls, rendered on the tabs row (or alone). */
  search?: ReactNode;
  tabs?: PageHeaderTab[];
  tab?: string;
  onTabChange?: (id: string) => void;
  onBack?: () => void;
  /** Rendered after the title (a StatusChip, a Badge). */
  badge?: ReactNode;
}

/**
 * Header for list and detail pages: title, description and actions on the
 * first row; optional tabs and a search slot on the second. Sticks to the top
 * of a scrolling page when placed inside one.
 */
export const PageHeader = forwardRef<HTMLElement, PageHeaderProps>(function PageHeader(
  {
    title,
    description,
    eyebrow,
    actions,
    search,
    tabs,
    tab,
    onTabChange,
    onBack,
    badge,
    className,
    ...rest
  },
  ref,
) {
  const hasSecondRow = (tabs && tabs.length > 0) || search;
  return (
    <header
      ref={ref}
      className={cn(
        "flex flex-col gap-3 border-b border-border bg-canvas px-6 pt-5",
        hasSecondRow ? "pb-0" : "pb-4",
        className,
      )}
      {...rest}
    >
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="flex min-w-0 items-start gap-2">
          {onBack ? (
            <IconButton label="Back" onClick={onBack} className="-ml-1.5 mt-0.5">
              <ArrowLeft strokeWidth={1.75} />
            </IconButton>
          ) : null}
          <div className="flex min-w-0 flex-col gap-1">
            {eyebrow ? <p className="text-eyebrow">{eyebrow}</p> : null}
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <h1 className="truncate text-lg font-semibold leading-tight tracking-tight text-ink">
                {title}
              </h1>
              {badge}
            </div>
            {description ? (
              <p className="max-w-2xl text-sm leading-normal text-ink-2">{description}</p>
            ) : null}
          </div>
        </div>
        {actions ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
        ) : null}
      </div>
      {hasSecondRow ? (
        <div className="flex min-w-0 flex-wrap items-end justify-between gap-x-4 gap-y-2">
          {tabs && tabs.length > 0 ? (
            <Tabs value={tab} onValueChange={onTabChange} className="min-w-0">
              <TabsList className="border-b-0">
                {tabs.map((t) => (
                  <TabsTrigger
                    key={t.id}
                    value={t.id}
                    count={t.count}
                    icon={t.icon}
                    disabled={t.disabled}
                  >
                    {t.label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          ) : (
            <span />
          )}
          {search ? <div className="flex min-w-0 items-center gap-2 pb-2">{search}</div> : null}
        </div>
      ) : null}
    </header>
  );
});
