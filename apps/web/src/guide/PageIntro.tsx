"use client";
/**
 * "Start here" at the top of every page in the navigation: what the page is for, when to use it,
 * what it needs (checked live against the workspace), how to start and what you end up with.
 * People who know the page collapse it to one line; it remembers that per browser and reopens
 * from the same line. A page with nothing in it yet starts expanded, one with content collapsed,
 * and on a phone it starts collapsed so the page itself comes first. Until the page's data has
 * arrived it keeps the shape it settled on last time in this workspace (on a first visit, the
 * page's `defaultCollapsed` as it stands), so the content below does not jump when it decides.
 */
import { QueryClientContext, type Query, type QueryClient } from "@tanstack/react-query";
import { useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { BookOpenText, ChevronDown, ChevronRight, Compass, Lightbulb, Eye } from "lucide-react";
import { usePathname } from "next/navigation";
import { Badge, Button } from "@flowaid/ui/primitives";
import { useMediaQuery } from "~/shell/useMediaQuery";
import { useGuide } from "./GuideProvider";
import { CheckList, type Check } from "./Readiness";
import { usePref } from "./storage";
import type { CapabilityGuide } from "./capabilities/types";

/** Below Tailwind's `md`: phones, where the page's own content should fill the first screen. */
const PHONE = "(max-width: 47.999rem)";

/**
 * A query still waiting for its first answer. With `starting`, also one built during this render
 * whose observer has not subscribed yet (that happens after the render), unless it is disabled.
 */
function waiting(q: Query, starting: boolean): boolean {
  if (q.state.status !== "pending") return false;
  if (q.state.fetchStatus === "fetching") return true;
  if (!starting || q.getObserversCount() > 0 || q.state.errorUpdateCount > 0) return false;
  const enabled = (q.options as { enabled?: boolean | ((q: Query) => boolean) }).enabled;
  return (typeof enabled === "function" ? enabled(q) : enabled) !== false;
}

const anyWaiting = (client: QueryClient, starting: boolean) =>
  client
    .getQueryCache()
    .getAll()
    .some((q) => waiting(q, starting));

/** Never hold the page back longer than this for a slow or retrying request. */
const SETTLE_LIMIT_MS = 4000;

/**
 * False while the page's first data is still on its way (`defaultCollapsed` is not known yet),
 * true once every first load has answered. It only ever turns true.
 */
function useFirstDataSettled(): boolean {
  const client = useContext(QueryClientContext);
  const [settled, setSettled] = useState(() => !client || !anyWaiting(client, true));
  useEffect(() => {
    if (settled || !client) return;
    // the page's own queries start as its effects subscribe them, after this one: judge only
    // from the next task on, then on every change in the cache
    let armed = false;
    const check = () => {
      if (armed && !anyWaiting(client, false)) setSettled(true);
    };
    const unsubscribe = client.getQueryCache().subscribe(check);
    const start = setTimeout(() => {
      armed = true;
      check();
    }, 0);
    const limit = setTimeout(() => setSettled(true), SETTLE_LIMIT_MS);
    return () => {
      unsubscribe();
      clearTimeout(start);
      clearTimeout(limit);
    };
  }, [client, settled]);
  return settled;
}

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
  // how this page's intro settled last time in this workspace: the best guess while the data
  // loads (a page that had content still has it), so the page does not jump when it settles; a
  // first visit takes `defaultCollapsed` as it stands
  const ws = usePathname()?.split("/")[1] ?? "";
  const [last, setLast] = usePref(`flowaid:intro-default:${ws}:${guide.id}`, "");
  const phone = useMediaQuery(PHONE);
  const settled = useFirstDataSettled();
  const guess = settled || last === "" ? defaultCollapsed : last === "collapsed";
  // a stored choice wins; otherwise phones start collapsed, and the rest follow the data
  const collapsed = pref === "" ? phone || guess : pref === "hidden";
  useEffect(() => {
    const outcome = defaultCollapsed ? "collapsed" : "expanded";
    if (settled && last !== outcome) setLast(outcome);
  }, [settled, defaultCollapsed, last, setLast]);
  // Hide and "About …" replace each other: focus follows to the one that appears
  const toggleRef = useRef<HTMLButtonElement>(null);
  const refocus = useRef(false);
  const setCollapsed = (next: boolean) => {
    refocus.current = true;
    setPref(next ? "hidden" : "shown");
  };
  useEffect(() => {
    if (!refocus.current) return;
    refocus.current = false;
    toggleRef.current?.focus();
  }, [collapsed]);
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
          ref={toggleRef}
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
          ref={toggleRef}
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
