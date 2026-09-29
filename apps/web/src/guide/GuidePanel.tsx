"use client";
/**
 * The Guide's docked panel. It does not cover the page with an overlay or trap focus, so a person
 * can keep it open while they click through the steps it describes.
 */
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowLeft, Compass, ExternalLink, MessageSquareText } from "lucide-react";
import {
  Button,
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@flowaid/ui/primitives";
import { useAssistant } from "~/assistant/AssistantProvider";
import { useSession } from "~/session";
import { HELP } from "~/shell/help";
import { explainRun, explainStep, explainWorkflow, nextForRun } from "./explain";
import {
  BUILDER_GUIDE,
  GLOSSARY,
  PAGE_GUIDES,
  RUN_GUIDE,
  sectionOf,
  type PageGuide,
} from "./pages";
import type { GuideContext } from "./GuideProvider";

function guideFor(pathname: string, context: GuideContext | null): PageGuide | undefined {
  if (context?.kind === "builder") return BUILDER_GUIDE;
  if (context?.kind === "run") return RUN_GUIDE;
  return PAGE_GUIDES[sectionOf(pathname)];
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2" aria-label={title}>
      <h3 className="text-eyebrow">{title}</h3>
      {children}
    </section>
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
  const guide = guideFor(pathname, context);
  const href = (to: string) => (/^https?:/.test(to) ? to : to ? `/${s.ws}/${to}` : `/${s.ws}`);

  return (
    <Sheet open={open} onOpenChange={onOpenChange} modal={false}>
      <SheetContent
        width={400}
        noOverlay
        // below the top bar, so Run, Publish and the Guide button stay in reach
        className="top-11"
        aria-label="Guide"
        // the page stays usable while the Guide is open
        onInteractOutside={(e) => e.preventDefault()}
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Compass className="size-4 text-accent" strokeWidth={1.75} aria-hidden />
            Guide{guide ? <span className="font-normal text-ink-3">· {guide.title}</span> : null}
          </SheetTitle>
          <SheetDescription>
            {guide?.purpose ?? "Plain-language help for the page you are on and what to do next."}
          </SheetDescription>
        </SheetHeader>

        <SheetBody className="flex flex-col gap-6">
          {context?.kind === "builder" ? <BuilderHelp context={context} /> : null}
          {context?.kind === "run" ? <RunHelp context={context} /> : null}

          {guide ? (
            <Section title="How to use this page">
              <ol className="m-0 flex list-decimal flex-col gap-1.5 pl-5 text-sm text-ink-2">
                {guide.steps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
              {guide.actions.length ? (
                <div className="flex flex-wrap gap-1.5 pt-1">
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
            <Section title="Words you will see">
              <dl className="m-0 flex flex-col gap-2.5">
                {guide.terms.map((id) => (
                  <div key={id}>
                    <dt className="text-sm font-medium text-ink">{GLOSSARY[id]?.term}</dt>
                    <dd className="m-0 text-sm text-ink-2">{GLOSSARY[id]?.meaning}</dd>
                  </div>
                ))}
              </dl>
            </Section>
          ) : null}

          <Section title="More help">
            <div className="flex flex-col gap-1.5">
              {assistant?.available ? (
                <Button
                  size="sm"
                  variant="secondary"
                  className="self-start"
                  leadingIcon={<MessageSquareText strokeWidth={1.75} />}
                  onClick={() => assistant.setOpen(true)}
                >
                  Ask a question in your own words
                </Button>
              ) : null}
              <a
                className="inline-flex items-center gap-1 text-sm text-accent-text hover:underline"
                href={HELP.gettingStarted}
                target="_blank"
                rel="noreferrer"
              >
                Read the getting started guide
                <ExternalLink className="size-3.5" strokeWidth={1.75} aria-hidden />
              </a>
            </div>
          </Section>
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}

function StoryList({ lines }: { lines: string[] }) {
  return (
    <ol className="m-0 flex list-decimal flex-col gap-1.5 pl-5 text-sm text-ink">
      {lines.map((line, i) => (
        <li key={i}>{line}</li>
      ))}
    </ol>
  );
}

function BuilderHelp({ context }: { context: Extract<GuideContext, { kind: "builder" }> }) {
  const { definition, selected, manifest } = context;
  if (selected && selected.kind !== "note") {
    const step = explainStep(selected, definition, manifest);
    return (
      <Section title={`This step: ${selected.name}`}>
        <p className="text-sm text-ink">{step.summary}</p>
        {step.details.length ? (
          <ul className="m-0 flex list-disc flex-col gap-1.5 pl-5 text-sm text-ink-2">
            {step.details.map((d) => (
              <li key={d}>{d}</li>
            ))}
          </ul>
        ) : null}
        {step.change ? <p className="text-sm text-ink-3">{step.change}</p> : null}
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
        <Section title="The last run, in plain words">
          <StoryList lines={story} />
        </Section>
      ) : null}
      <Section title="How this workflow works">
        <ol className="m-0 flex list-decimal flex-col gap-2 pl-5 text-sm">
          {flow.steps.map((st) => (
            <li key={st.id}>
              {context.onSelectStep ? (
                <button
                  type="button"
                  className="font-medium text-accent-text hover:underline"
                  onClick={() => context.onSelectStep?.(st.id)}
                >
                  {st.name}
                </button>
              ) : (
                <span className="font-medium text-ink">{st.name}</span>
              )}
              <span className="text-ink-2">: {st.summary}</span>
            </li>
          ))}
        </ol>
        {flow.outcomes.length ? (
          <p className="text-sm text-ink-2">
            It can end in: <span className="text-ink">{flow.outcomes.join(" · ")}</span>
          </p>
        ) : null}
      </Section>
      {flow.settings.length ? (
        <Section title="Settings you can change">
          <ul className="m-0 flex list-disc flex-col gap-1.5 pl-5 text-sm text-ink-2">
            {flow.settings.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
          <p className="text-sm text-ink-3">Click the empty canvas to change them.</p>
        </Section>
      ) : null}
    </>
  );
}

function RunHelp({ context }: { context: Extract<GuideContext, { kind: "run" }> }) {
  // the page itself tells the story; the Guide says what to do with it
  return (
    <Section title="What you can do next">
      <ul className="m-0 flex list-disc flex-col gap-1.5 pl-5 text-sm text-ink">
        {nextForRun(context.run).map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </Section>
  );
}
