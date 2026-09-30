"use client";
/**
 * "Start here" at the top of every page in the navigation: what the page is for, when to use it,
 * what it needs (checked live against the workspace), how to start and what you end up with.
 * People who know the page collapse it to one line; it remembers that per browser and reopens
 * from the same line. A page with nothing in it yet starts expanded, one with content collapsed.
 */
import type { ReactNode } from "react";
import { BookOpenText, ChevronDown, ChevronRight, Compass, Lightbulb, Eye } from "lucide-react";
import { Badge, Button } from "@flowaid/ui/primitives";
import { useGuide } from "./GuideProvider";
import { CheckList, type Check } from "./Readiness";
import { usePref } from "./storage";
import type { CapabilityGuide } from "./capabilities/types";

export function PageIntro({
  guide,
  checks = [],
  actions,
  defaultCollapsed = false,
  className = "mt-4",
}: {
  guide: CapabilityGuide;
  /** what the page needs, each computed from real workspace state */
  checks?: readonly Check[];
  /** the page's primary way to start (the same buttons its header offers) */
  actions?: ReactNode;
  /** start collapsed (the page already has content); a stored choice wins */
  defaultCollapsed?: boolean;
  className?: string;
}) {
  const [pref, setPref] = usePref(`flowaid:intro:${guide.id}`, "");
  const collapsed = pref === "" ? defaultCollapsed : pref === "hidden";
  const setCollapsed = (next: boolean) => setPref(next ? "hidden" : "shown");
  const helper = useGuide();
  const missing = checks.filter((c) => c.state === "blocker").length;
  const warnings = checks.filter((c) => c.state === "warning").length;
  const headingId = `intro-${guide.id}`;

  if (collapsed)
    return (
      <div
        className={`flex flex-wrap items-center gap-2 rounded-md border border-border bg-surface px-3 py-1.5 ${className}`}
      >
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          aria-expanded={false}
          className="inline-flex items-center gap-1.5 rounded-xs text-xs font-medium text-ink-2 hover:text-ink focus-visible:shadow-(--focus) focus-visible:outline-none"
        >
          <ChevronRight className="size-3.5 text-ink-3" strokeWidth={1.75} aria-hidden />
          <Compass className="size-3.5 text-accent-text" strokeWidth={1.75} aria-hidden />
          About {guide.title}
        </button>
        <span className="min-w-0 flex-1 truncate text-xs text-ink-3">{guide.what}</span>
        {missing > 0 ? (
          <Badge tone="danger">
            {missing === 1 ? "1 thing to set up" : `${missing} to set up`}
          </Badge>
        ) : warnings > 0 ? (
          <Badge tone="warn">{warnings === 1 ? "1 thing to check" : `${warnings} to check`}</Badge>
        ) : null}
      </div>
    );

  return (
    <section
      aria-labelledby={headingId}
      className={`rounded-md border border-border bg-surface shadow-1 ${className}`}
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2">
        <Compass className="size-4 text-accent-text" strokeWidth={1.75} aria-hidden />
        <h2 id={headingId} className="m-0 text-sm font-semibold text-ink">
          Start here: {guide.title}
        </h2>
        <span className="flex-1" />
        {helper ? (
          <Button
            size="sm"
            variant="ghost"
            leadingIcon={<BookOpenText strokeWidth={1.75} />}
            onClick={() => helper.setOpen(true)}
          >
            More in the Guide
          </Button>
        ) : null}
        <Button
          size="sm"
          variant="ghost"
          leadingIcon={<ChevronDown strokeWidth={1.75} />}
          aria-expanded
          onClick={() => setCollapsed(true)}
        >
          Hide
        </Button>
      </div>
      <div className="grid gap-x-6 gap-y-4 px-4 py-3 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <dl className="m-0 grid gap-2.5 text-sm">
          <Answer term="What you can do here">{guide.what}</Answer>
          <Answer term="When to use it">{guide.when}</Answer>
          <Answer term="What you get">{guide.result}</Answer>
          <Answer term="How to start">
            {guide.start}
            {actions ? <span className="mt-2 flex flex-wrap gap-2">{actions}</span> : null}
          </Answer>
        </dl>
        <div className="flex flex-col gap-2">
          <p className="text-eyebrow m-0">What you need</p>
          <p className="m-0 text-sm text-ink-2">{guide.needs}</p>
          {checks.length ? <CheckList checks={checks} aria-label="What this page needs" /> : null}
        </div>
      </div>
      {guide.reading || guide.quality ? (
        <div className="grid gap-x-6 gap-y-3 border-t border-border px-4 py-3 md:grid-cols-2">
          {guide.reading ? (
            <Tips icon={Eye} title={guide.reading.title} items={guide.reading.items} />
          ) : null}
          {guide.quality ? (
            <Tips icon={Lightbulb} title={guide.quality.title} items={guide.quality.items} />
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function Answer({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs font-medium text-ink-3">{term}</dt>
      <dd className="m-0 text-ink-2">{children}</dd>
    </div>
  );
}

function Tips({
  icon: Icon,
  title,
  items,
}: {
  icon: typeof Eye;
  title: string;
  items: readonly string[];
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <p className="m-0 flex items-center gap-1.5 text-xs font-semibold text-ink">
        <Icon className="size-3.5 text-accent-text" strokeWidth={1.75} aria-hidden />
        {title}
      </p>
      <ul className="m-0 flex list-disc flex-col gap-1 pl-5 text-xs leading-snug text-ink-2">
        {items.map((t) => (
          <li key={t}>{t}</li>
        ))}
      </ul>
    </div>
  );
}
