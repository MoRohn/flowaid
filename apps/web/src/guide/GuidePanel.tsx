"use client";
/**
 * The Guide's panel: a complementary landmark, not a dialog. It does not cover the page with an
 * overlay or hold keyboard focus, so a person can keep it open while they click through the steps
 * it describes, and Tab moves on from its last control. Escape (with focus inside it) or its close
 * button closes it and puts focus on the top bar's Guide button. On wide screens it docks beside
 * the page (the page makes room, see AppFrame); on narrower ones it floats over the right edge as
 * a card, so the canvas and tables keep their full width.
 */
import { useCallback, useState, type KeyboardEvent, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  BookOpenText,
  Boxes,
  CircleCheck,
  Clock,
  Compass,
  ExternalLink,
  Flag,
  GitBranch,
  GitMerge,
  Lightbulb,
  ListOrdered,
  MessageSquareText,
  Play,
  Repeat,
  Route,
  SlidersHorizontal,
  Sparkles,
  UserCheck,
  Workflow,
  X,
  type LucideIcon,
} from "lucide-react";
import {
  Button,
  CollapsibleContent,
  CollapsibleRoot,
  CollapsibleTrigger,
  IconButton,
} from "@flowaid/ui/primitives";
import type { WorkflowNode } from "@flowaid/workflow-core";
import { useAssistant } from "~/assistant/AssistantProvider";
import { useSession } from "~/session";
import { HELP } from "~/shell/help";
import { explainRun, explainStep, explainWorkflow, nextForRun } from "./explain";
import {
  BUILDER_GUIDE,
  GLOSSARY,
  PAGE_GUIDES,
  RUN_GUIDE,
  WORKFLOW_PAGE_GUIDES,
  sectionOf,
  type PageGuide,
} from "./pages";
import type { GuideContext } from "./GuideProvider";

/** Width of the Guide; AppFrame reserves the same when it docks. */
export const GUIDE_WIDTH = 380;

/** The panel's id, for the Guide button's `aria-controls`. */
export const GUIDE_PANEL_ID = "flowaid-guide";

/** Marks the top bar's Guide button, where focus goes when the panel closes from inside. */
export const GUIDE_TOGGLE_ATTRIBUTE = "data-guide-toggle";

/**
 * Where the Guide docks beside the page instead of floating over it: from 1280 px (laptops) on
 * list and detail pages; on the builder's canvas only from 1680 px, so the canvas keeps its width
 * and the Guide floats over its edge below that.
 */
export function guideDock(context: GuideContext | null): "laptop" | "wide" {
  return context?.kind === "builder" ? "wide" : "laptop";
}

// Tailwind needs the full class names in the source, one set per breakpoint.
const DOCKED = {
  laptop: {
    panel:
      "min-[1280px]:bottom-0 min-[1280px]:right-0 min-[1280px]:top-11 min-[1280px]:rounded-none min-[1280px]:border-y-0 min-[1280px]:border-r-0 min-[1280px]:shadow-none",
    footer: "min-[1280px]:rounded-none",
  },
  wide: {
    panel:
      "min-[1680px]:bottom-0 min-[1680px]:right-0 min-[1680px]:top-11 min-[1680px]:rounded-none min-[1680px]:border-y-0 min-[1680px]:border-r-0 min-[1680px]:shadow-none",
    footer: "min-[1680px]:rounded-none",
  },
} as const;

/** The room AppFrame makes beside the page while the Guide is docked. */
export const GUIDE_ROOM = {
  laptop: "min-[1280px]:[&>[data-shell-body]]:pr-[380px]",
  wide: "min-[1680px]:[&>[data-shell-body]]:pr-[380px]",
} as const;

function guideFor(pathname: string, context: GuideContext | null): PageGuide | undefined {
  if (context?.kind === "builder") return BUILDER_GUIDE;
  if (context?.kind === "run") return RUN_GUIDE;
  // /ws/workflows/<id>/<page>: the workflow's own page, not the list
  const [, , section, id, page] = pathname.split("/");
  if (section === "workflows" && id && id !== "new" && page && WORKFLOW_PAGE_GUIDES[page])
    return WORKFLOW_PAGE_GUIDES[page];
  return PAGE_GUIDES[sectionOf(pathname)];
}

// ── which sections are open, remembered per browser ──────────────────────────────────────────

const SECTIONS_KEY = "flowaid:guide-sections";

function readSections(): Record<string, boolean> {
  try {
    const raw = window.localStorage.getItem(SECTIONS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? (parsed as Record<string, boolean>) : {};
  } catch {
    return {}; // storage blocked or garbled: every section uses its default
  }
}

function useSections() {
  const [open, setOpen] = useState<Record<string, boolean>>(() =>
    typeof window === "undefined" ? {} : readSections(),
  );
  const toggle = useCallback((id: string, next: boolean) => {
    setOpen((prev) => {
      const updated = { ...prev, [id]: next };
      try {
        window.localStorage.setItem(SECTIONS_KEY, JSON.stringify(updated));
      } catch {
        // storage blocked: the change still applies while the page is open
      }
      return updated;
    });
  }, []);
  return { open, toggle };
}

type Sections = ReturnType<typeof useSections>;

function Section({
  id,
  title,
  icon: Icon,
  meta,
  defaultOpen = true,
  sections,
  children,
}: {
  id: string;
  title: string;
  icon: LucideIcon;
  meta?: ReactNode;
  defaultOpen?: boolean;
  sections: Sections;
  children: ReactNode;
}) {
  const open = sections.open[id] ?? defaultOpen;
  return (
    <CollapsibleRoot open={open} onOpenChange={(next) => sections.toggle(id, next)} asChild>
      <section aria-label={title} className="flex flex-col">
        <CollapsibleTrigger
          className="h-8 gap-2 px-1.5 text-[13px] font-semibold text-ink"
          {...(meta !== undefined ? { meta } : {})}
        >
          <span className="flex items-center gap-2">
            <Icon className="size-3.5 shrink-0 text-accent-text" strokeWidth={1.75} aria-hidden />
            {title}
          </span>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="flex flex-col gap-3 px-1.5 pb-1 pt-2">{children}</div>
        </CollapsibleContent>
      </section>
    </CollapsibleRoot>
  );
}

/** Numbered steps with round badges, easier to follow than a bare `1.` list. */
function Steps({ items }: { items: readonly string[] }) {
  return (
    <ol className="m-0 flex list-none flex-col gap-2.5 p-0">
      {items.map((item, i) => (
        <li key={item} className="flex gap-2.5 text-sm leading-snug text-ink-2">
          <span
            aria-hidden
            className="mt-px flex size-5 shrink-0 items-center justify-center rounded-full border border-border bg-surface-2 font-mono text-2xs text-ink-2 tabular"
          >
            {i + 1}
          </span>
          <span className="min-w-0">{item}</span>
        </li>
      ))}
    </ol>
  );
}

function Bullets({
  items,
  icon: Icon = CircleCheck,
}: {
  items: readonly string[];
  icon?: LucideIcon;
}) {
  return (
    <ul className="m-0 flex list-none flex-col gap-2 p-0">
      {items.map((item) => (
        <li key={item} className="flex gap-2 text-sm leading-snug text-ink-2">
          <Icon className="mt-0.5 size-3.5 shrink-0 text-ink-3" strokeWidth={1.75} aria-hidden />
          <span className="min-w-0">{item}</span>
        </li>
      ))}
    </ul>
  );
}

function Tip({ children }: { children: ReactNode }) {
  return (
    <p className="m-0 flex gap-2 rounded-sm border border-border bg-surface-2 px-2.5 py-2 text-xs leading-snug text-ink-2">
      <Lightbulb
        className="mt-px size-3.5 shrink-0 text-warn-text"
        strokeWidth={1.75}
        aria-hidden
      />
      <span>{children}</span>
    </p>
  );
}

export function GuidePanel({
  open,
  onOpenChange,
  context,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  context: GuideContext | null;
}) {
  const s = useSession();
  const pathname = usePathname();
  const assistant = useAssistant();
  const sections = useSections();
  const guide = guideFor(pathname, context);
  const href = (to: string) => (/^https?:/.test(to) ? to : to ? `/${s.ws}/${to}` : `/${s.ws}`);

  // closing from inside the panel would otherwise drop focus to <body> as the panel goes
  const close = () => {
    onOpenChange(false);
    document.querySelector<HTMLElement>(`[${GUIDE_TOGGLE_ATTRIBUTE}]`)?.focus();
  };
  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key !== "Escape" || e.defaultPrevented) return;
    e.preventDefault();
    close();
  };

  if (!open) return null;
  return (
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- Escape from any control inside closes the panel
    <aside
      id={GUIDE_PANEL_ID}
      aria-label="Guide"
      data-state="open"
      onKeyDown={onKeyDown}
      style={{ width: `min(${GUIDE_WIDTH}px, calc(100vw - 32px))` }}
      // Narrow screens: a floating card below the top bar, over the page's right edge.
      // Wide screens (where AppFrame makes room): docked full height beside the page.
      className={
        "fa-sheet-right fixed bottom-3 right-3 top-14 z-40 flex flex-col rounded-md border border-border bg-surface text-ink shadow-3 " +
        DOCKED[guideDock(context)].panel
      }
    >
      <header className="relative flex shrink-0 flex-col gap-2 border-b border-border px-4 pb-3.5 pr-11 pt-3.5">
        <div className="flex items-center gap-2.5">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-sm bg-accent-soft text-accent-text">
            <Compass className="size-4" strokeWidth={1.75} aria-hidden />
          </span>
          <span className="flex min-w-0 flex-col">
            <span className="text-2xs font-medium uppercase tracking-wider text-ink-3">Guide</span>
            <h2 className="m-0 truncate text-[15px] font-semibold leading-tight tracking-tight text-ink">
              {guide?.title ?? "This page"}
            </h2>
          </span>
        </div>
        <p className="m-0 text-[13px] leading-snug text-ink-2">
          {guide?.purpose ?? "Plain-language help for the page you are on and what to do next."}
        </p>
        <IconButton
          label="Close the Guide"
          size="sm"
          tooltip={false}
          className="absolute right-2.5 top-2.5"
          onClick={close}
        >
          <X strokeWidth={1.75} />
        </IconButton>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-1 divide-y divide-border overflow-y-auto px-3 py-2 text-sm text-ink-2 [&>*]:py-2">
        {context?.kind === "builder" ? <BuilderHelp context={context} sections={sections} /> : null}
        {context?.kind === "run" ? <RunHelp context={context} sections={sections} /> : null}

        {guide ? (
          <Section
            id="how"
            title="How to use this page"
            icon={ListOrdered}
            meta={guide.steps.length}
            // on the builder and run pages the page's own story comes first
            defaultOpen={!context}
            sections={sections}
          >
            <Steps items={guide.steps} />
            {guide.actions.length ? (
              <div className="flex flex-wrap gap-1.5">
                {guide.actions.map((a) => (
                  <Button key={a.label} size="sm" variant="secondary" asChild>
                    <Link href={href(a.to)}>{a.label}</Link>
                  </Button>
                ))}
              </div>
            ) : null}
          </Section>
        ) : null}

        {guide?.terms.length ? (
          <Section
            id="terms"
            title="Words you will see"
            icon={BookOpenText}
            meta={guide.terms.length}
            defaultOpen={false}
            sections={sections}
          >
            <dl className="m-0 flex flex-col gap-2">
              {guide.terms.map((id) => (
                <div key={id} className="rounded-sm border border-border bg-surface-2 px-2.5 py-2">
                  <dt className="text-[13px] font-medium text-ink">{GLOSSARY[id]?.term}</dt>
                  <dd className="m-0 mt-0.5 text-xs leading-snug text-ink-2">
                    {GLOSSARY[id]?.meaning}
                  </dd>
                </div>
              ))}
            </dl>
          </Section>
        ) : null}
      </div>

      <footer
        className={`flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 rounded-b-md border-t border-border bg-surface-2 px-4 py-2.5 ${DOCKED[guideDock(context)].footer}`}
      >
        {assistant?.available ? (
          <Button
            size="sm"
            variant="secondary"
            leadingIcon={<MessageSquareText strokeWidth={1.75} />}
            onClick={() => assistant.setOpen(true)}
          >
            Ask a question
          </Button>
        ) : null}
        <a
          className="inline-flex items-center gap-1 text-xs text-accent-text hover:underline"
          href={HELP.gettingStarted}
          target="_blank"
          rel="noreferrer"
        >
          Getting started guide
          <ExternalLink className="size-3" strokeWidth={1.75} aria-hidden />
        </a>
      </footer>
    </aside>
  );
}

const KIND_ICON: Partial<Record<WorkflowNode["kind"], LucideIcon>> = {
  input: Play,
  output: Flag,
  task: Sparkles,
  branch: GitBranch,
  join: GitMerge,
  loop: Repeat,
  foreach: Repeat,
  subflow: Workflow,
  wait: Clock,
  human: UserCheck,
};

/** The workflow as a vertical path: one row per step, joined by a line. */
function Timeline({
  steps,
  onSelect,
}: {
  steps: { id: string; name: string; kind: WorkflowNode["kind"]; summary: string }[];
  onSelect?: (id: string) => void;
}) {
  return (
    <ol className="m-0 flex list-none flex-col p-0">
      {steps.map((st, i) => {
        const Icon = KIND_ICON[st.kind] ?? Boxes;
        const last = i === steps.length - 1;
        return (
          <li key={st.id} className="relative flex gap-2.5 pb-3 last:pb-0">
            {!last ? (
              <span aria-hidden className="absolute bottom-0 left-[11px] top-6 w-px bg-border" />
            ) : null}
            <span
              aria-hidden
              className="relative flex size-6 shrink-0 items-center justify-center rounded-full border border-border bg-surface-2 text-ink-2"
            >
              <Icon className="size-3" strokeWidth={1.75} />
            </span>
            <span className="flex min-w-0 flex-col gap-0.5 pt-0.5">
              {onSelect ? (
                <button
                  type="button"
                  className="self-start text-left text-[13px] font-medium text-accent-text hover:underline focus-visible:underline"
                  onClick={() => onSelect(st.id)}
                >
                  {st.name}
                </button>
              ) : (
                <span className="text-[13px] font-medium text-ink">{st.name}</span>
              )}
              <span className="text-xs leading-snug text-ink-2">{st.summary}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function BuilderHelp({
  context,
  sections,
}: {
  context: Extract<GuideContext, { kind: "builder" }>;
  sections: Sections;
}) {
  const { definition, selected, manifest } = context;
  if (selected && selected.kind !== "note") {
    const step = explainStep(selected, definition, manifest);
    const Icon = KIND_ICON[selected.kind] ?? Boxes;
    return (
      <Section id="step" title="This step" icon={Icon} sections={sections}>
        <div className="rounded-sm border border-border bg-surface-2 px-3 py-2.5">
          <p className="m-0 text-[13px] font-semibold text-ink">{selected.name}</p>
          <p className="m-0 mt-1 text-sm leading-snug text-ink-2">{step.summary}</p>
        </div>
        {step.details.length ? <Bullets items={step.details} /> : null}
        {step.change ? <Tip>{step.change}</Tip> : null}
        {context.onClearStep ? (
          <Button
            size="sm"
            variant="ghost"
            className="self-start"
            leadingIcon={<ArrowLeft strokeWidth={1.75} />}
            onClick={context.onClearStep}
          >
            How the whole workflow works
          </Button>
        ) : null}
      </Section>
    );
  }
  const flow = explainWorkflow(definition);
  const story = context.run ? explainRun(context.run, definition) : [];
  return (
    <>
      {story.length ? (
        <Section id="last-run" title="The last run" icon={Route} sections={sections}>
          <Steps items={story} />
        </Section>
      ) : null}
      <Section
        id="flow"
        title="How this workflow works"
        icon={Workflow}
        meta={flow.steps.length}
        sections={sections}
      >
        <Timeline
          steps={flow.steps}
          {...(context.onSelectStep ? { onSelect: context.onSelectStep } : {})}
        />
        {flow.outcomes.length ? (
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-ink-3">It can end in</span>
            <div className="flex flex-wrap gap-1.5">
              {flow.outcomes.map((o) => (
                <span
                  key={o}
                  className="inline-flex items-center gap-1 rounded-xs border border-border bg-surface-2 px-1.5 py-1 text-xs text-ink"
                >
                  <Flag className="size-3 text-ink-3" strokeWidth={1.75} aria-hidden />
                  {o}
                </span>
              ))}
            </div>
          </div>
        ) : null}
      </Section>
      {flow.variables.length ? (
        <Section
          id="settings"
          title="Settings you can change"
          icon={SlidersHorizontal}
          meta={flow.variables.length}
          sections={sections}
        >
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {flow.variables.map((v) => (
              <li
                key={v.name}
                className="flex flex-col gap-1 rounded-sm border border-border bg-surface-2 px-2.5 py-2"
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="text-[13px] font-medium text-ink">{v.name}</span>
                  {v.value !== undefined ? (
                    <span className="max-w-[45%] truncate rounded-xs bg-surface-3 px-1.5 py-0.5 font-mono text-2xs text-ink">
                      {v.value}
                    </span>
                  ) : null}
                </span>
                {v.description ? (
                  <span className="text-xs leading-snug text-ink-2">{v.description}</span>
                ) : null}
              </li>
            ))}
          </ul>
          <Tip>Click an empty spot on the canvas to change these for the whole workflow.</Tip>
        </Section>
      ) : null}
    </>
  );
}

function RunHelp({
  context,
  sections,
}: {
  context: Extract<GuideContext, { kind: "run" }>;
  sections: Sections;
}) {
  // the page itself tells the story; the Guide says what to do with it
  return (
    <Section id="run-next" title="What you can do next" icon={CircleCheck} sections={sections}>
      <Bullets items={nextForRun(context.run)} icon={ArrowRight} />
    </Section>
  );
}
