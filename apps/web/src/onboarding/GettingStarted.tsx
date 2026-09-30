"use client";
/**
 * The getting-started checklist on the Overview: seven steps from an empty install to a workflow
 * called from code. Each step ticks off from the workspace's real state (`steps.ts`); the panel
 * can be hidden per browser and comes back from the help menu (`?getting-started`).
 */
import { useQuery } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useSyncExternalStore, type ReactNode } from "react";
import { Check, ExternalLink, X } from "lucide-react";
import { Badge, Button, IconButton, ProgressBar } from "@flowaid/ui/primitives";
import { get, getAll } from "~/api/client";
import type { Page, WorkflowSummary } from "~/api/types";
import { useSession } from "~/session";
import { HELP, PROVIDER_KEY_URL } from "~/shell/help";
import {
  nextStep,
  onboardingProgress,
  onboardingSteps,
  type OnboardingStep,
  type OnboardingStepId,
} from "./steps";

const hiddenKey = (ws: string) => `flowaid:getting-started:hidden:${ws}`;

function readHidden(ws: string): boolean {
  try {
    return window.localStorage.getItem(hiddenKey(ws)) === "1";
  } catch {
    return false;
  }
}

const CHANGED = "flowaid:getting-started";

function writeHidden(ws: string, hidden: boolean): void {
  try {
    if (hidden) window.localStorage.setItem(hiddenKey(ws), "1");
    else window.localStorage.removeItem(hiddenKey(ws));
  } catch {
    // private windows and blocked storage: the panel simply shows again next time
  }
  window.dispatchEvent(new Event(CHANGED));
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(CHANGED, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(CHANGED, onChange);
    window.removeEventListener("storage", onChange);
  };
}

interface StepCopy {
  title: string;
  description: ReactNode;
  actions: { label: string; to?: string; href?: string }[];
  /** Shown instead of the actions while an earlier step is missing. */
  waitsFor?: string;
}

function copyFor(id: OnboardingStepId, ws: string, firstWorkflow: string | undefined): StepCopy {
  const afterWorkflow = firstWorkflow ? {} : { waitsFor: "After you create a workflow" };
  switch (id) {
    case "decisions":
      return {
        title: "Connect TypeSafe for decisions",
        description: (
          <>
            Decision nodes (yes or no, one of several options, a score) are answered by TypeSafe
            with calibrated probabilities. Add your key as a credential, or set{" "}
            <code className="font-mono text-2xs">TYPESAFE_API_KEY</code> in{" "}
            <code className="font-mono text-2xs">.env.local</code> and restart.
          </>
        ),
        actions: [
          { label: "Add the key", to: `/${ws}/credentials` },
          { label: "Get a key", href: PROVIDER_KEY_URL.typesafe },
        ],
      };
    case "generation":
      return {
        title: "Connect a model for generated text",
        description:
          "Replies, summaries and agents use OpenAI, Anthropic, or Ollama running on this computer. Optional: workflows made of decisions alone do not need one.",
        actions: [
          { label: "Add a key", to: `/${ws}/credentials` },
          { label: "OpenAI keys", href: PROVIDER_KEY_URL.openai },
          { label: "Anthropic keys", href: PROVIDER_KEY_URL.anthropic },
          { label: "Install Ollama", href: PROVIDER_KEY_URL.ollama },
        ],
      };
    case "workflow":
      return {
        title: "Create a workflow",
        description:
          "Start from a template, import a definition you already have, or build on a blank canvas. New here? The Message triage starter needs only the TypeSafe key.",
        actions: [
          { label: "Try the starter", to: `/${ws}/templates?use=message-triage` },
          { label: "Browse templates", to: `/${ws}/templates` },
          { label: "New workflow", to: `/${ws}/workflows/new` },
        ],
      };
    case "run":
      return {
        title: "Run it",
        description:
          "Open the workflow, fill in its input and press Run. The trace shows every node, each decision's probabilities and the cost.",
        actions: [{ label: "Open the workflow", to: `/${ws}/workflows/${firstWorkflow}` }],
        ...afterWorkflow,
      };
    case "review":
      return {
        title: "Answer a human task",
        description:
          "When a run needs a person (an approval, a review, a choice) it waits under Human tasks until someone answers.",
        actions: [
          { label: "Open Human tasks", to: `/${ws}/human-tasks` },
          { label: "How reviews work", href: HELP.humanInTheLoop },
        ],
      };
    case "publish":
      return {
        title: "Publish and deploy",
        description:
          "Publishing freezes a version. Deploying it to an environment is what API calls, webhooks and schedules run.",
        actions: [
          { label: "Open the workflow", to: `/${ws}/workflows/${firstWorkflow}` },
          { label: "Deployments", to: `/${ws}/workflows/${firstWorkflow}/deployments` },
        ],
        ...afterWorkflow,
      };
    case "api":
      return {
        title: "Call it from your code",
        description:
          "Create an API key, then start runs with the TypeScript SDK, the flowaid command line or plain HTTP.",
        actions: [
          { label: "Create an API key", to: `/${ws}/settings?tab=api-keys` },
          { label: "How to call it", href: HELP.callIt },
        ],
      };
  }
}

export function GettingStarted() {
  const s = useSession();
  const router = useRouter();
  const params = useSearchParams();
  // localStorage only exists in the browser: the server renders nothing (hidden)
  const hidden = useSyncExternalStore(
    subscribe,
    () => readHidden(s.ws),
    () => true,
  );
  // `?getting-started` (the help menu) brings a hidden checklist back
  const reopen = params.has("getting-started");
  useEffect(() => {
    if (reopen) writeHidden(s.ws, false);
  }, [s.ws, reopen]);

  const providers = useQuery({
    queryKey: ["providers", s.ws],
    queryFn: () => get<{ id: string; configuredOnServer: boolean }[]>("/v1/providers"),
    staleTime: 60_000,
  });
  const credentials = useQuery({
    queryKey: ["credentials", s.ws],
    queryFn: () => getAll<{ type: string }>("/v1/credentials"),
    enabled: s.can("credentials:read"),
  });
  const workflows = useQuery({
    queryKey: ["onboarding", "workflows", s.ws],
    queryFn: () => get<Page<WorkflowSummary>>("/v1/workflows?limit=50"),
  });
  const runs = useQuery({
    queryKey: ["onboarding", "runs", s.ws],
    queryFn: () => get<Page<{ id: string }>>("/v1/runs?limit=1"),
    enabled: s.can("runs:read"),
  });
  const tasks = useQuery({
    queryKey: ["onboarding", "tasks", s.ws],
    queryFn: () => get<Page<{ id: string }>>("/v1/human-tasks?status=responded&limit=1"),
    enabled: s.can("runs:read"),
  });
  const keys = useQuery({
    queryKey: ["api-keys", s.ws],
    queryFn: () => getAll<{ id: string }>("/v1/api-keys"),
    enabled: s.can("api_keys:manage"),
  });

  const loading = [providers, workflows].some((q) => q.isPending);
  if (hidden || loading) return null;

  const wfs = workflows.data?.items ?? [];
  const steps = onboardingSteps({
    serverKeys: Object.fromEntries((providers.data ?? []).map((p) => [p.id, p.configuredOnServer])),
    credentialTypes: (credentials.data ?? []).map((c) => c.type),
    workflows: wfs.map((w) => ({ id: w.id, latestVersion: w.latestVersion })),
    hasRun: (runs.data?.items.length ?? 0) > 0,
    hasAnsweredTask: (tasks.data?.items.length ?? 0) > 0,
    hasApiKey: (keys.data?.length ?? 0) > 0,
  });
  const progress = onboardingProgress(steps);
  const next = nextStep(steps);
  const hide = () => {
    writeHidden(s.ws, true);
  };

  return (
    <section
      aria-labelledby="getting-started-title"
      className="mb-6 overflow-hidden rounded-lg border border-border bg-surface shadow-1"
    >
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border px-4 py-3">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h2 id="getting-started-title" className="text-sm font-semibold text-ink">
            {progress.complete ? "You are set up" : "Get started with FlowAId"}
          </h2>
          <p className="text-xs text-ink-2">
            {progress.complete
              ? "Every step is done. Hide this list whenever you like; the help menu brings it back."
              : "From an empty install to a workflow your code can call. Each step ticks off by itself."}
          </p>
        </div>
        {/* on a phone the progress takes its own line under the title */}
        <div className="order-last flex basis-full flex-col gap-1 sm:order-none sm:w-40 sm:shrink-0 sm:basis-auto">
          <span className="font-mono text-2xs text-ink-3 tabular">
            {progress.done} of {progress.total} required done
          </span>
          <ProgressBar
            value={progress.done / progress.total}
            tone={progress.complete ? "ok" : "accent"}
            size="sm"
            label="Getting started progress"
          />
        </div>
        <IconButton label="Hide getting started" size="sm" onClick={hide}>
          <X strokeWidth={1.75} />
        </IconButton>
      </header>
      <ol className="divide-y divide-border">
        {steps.map((step, i) => (
          <StepRow
            key={step.id}
            index={i + 1}
            step={step}
            current={step.id === next}
            copy={copyFor(step.id, s.ws, wfs[0]?.id)}
            onGo={(to) => router.push(to)}
          />
        ))}
      </ol>
    </section>
  );
}

function StepRow({
  index,
  step,
  current,
  copy,
  onGo,
}: {
  index: number;
  step: OnboardingStep;
  current: boolean;
  copy: StepCopy;
  onGo: (to: string) => void;
}) {
  return (
    <li
      className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-start sm:gap-3"
      data-done={step.done || undefined}
      aria-current={current ? "step" : undefined}
    >
      <span
        aria-hidden="true"
        className={
          step.done
            ? "flex size-6 shrink-0 items-center justify-center rounded-full bg-ok-soft text-ok-text"
            : current
              ? "flex size-6 shrink-0 items-center justify-center rounded-full bg-accent font-mono text-2xs text-accent-ink"
              : "flex size-6 shrink-0 items-center justify-center rounded-full border border-border font-mono text-2xs text-ink-3"
        }
      >
        {step.done ? <Check className="size-3.5" strokeWidth={2.25} /> : index}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex flex-wrap items-center gap-2">
          <span className={step.done ? "text-sm text-ink-2" : "text-sm font-medium text-ink"}>
            {copy.title}
          </span>
          <span className="sr-only">{step.done ? "(done)" : "(to do)"}</span>
          {step.optional ? <Badge size="sm">optional</Badge> : null}
        </span>
        {step.done ? null : <p className="max-w-prose text-xs text-ink-2">{copy.description}</p>}
      </div>
      {step.done ? null : copy.waitsFor ? (
        <span className="shrink-0 pl-9 text-2xs text-ink-3 sm:pl-0 sm:pt-1">{copy.waitsFor}</span>
      ) : (
        <div className="flex shrink-0 flex-wrap items-center gap-1.5 pl-9 sm:pl-0">
          {copy.actions.map((a, i) =>
            a.href ? (
              <a
                key={a.label}
                href={a.href}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-7 items-center gap-1 rounded-sm px-2 text-xs text-accent-text hover:underline"
              >
                {a.label}
                <ExternalLink className="size-3" strokeWidth={1.75} aria-hidden="true" />
                <span className="sr-only">(opens in a new tab)</span>
              </a>
            ) : (
              <Button
                key={a.label}
                size="sm"
                variant={current && i === 0 ? "primary" : "secondary"}
                onClick={() => onGo(a.to as string)}
              >
                {a.label}
              </Button>
            ),
          )}
        </div>
      )}
    </li>
  );
}
