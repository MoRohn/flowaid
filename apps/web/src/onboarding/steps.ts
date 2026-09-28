/**
 * The getting-started checklist (pure, so it is unit tested): each step is done when the
 * workspace's real state shows it, never because someone ticked a box.
 */
export interface OnboardingState {
  /** provider id → a server key is set in the environment (`GET /v1/providers`) */
  serverKeys: Readonly<Record<string, boolean>>;
  /** credential types stored in the workspace (`typesafe.api_key`, `openai.api_key`, …) */
  credentialTypes: readonly string[];
  workflows: readonly { id: string; latestVersion: number | null }[];
  hasRun: boolean;
  hasAnsweredTask: boolean;
  hasApiKey: boolean;
}

export type OnboardingStepId =
  "decisions" | "generation" | "workflow" | "run" | "review" | "publish" | "api";

export interface OnboardingStep {
  id: OnboardingStepId;
  done: boolean;
  /** Useful but not needed to finish: decision-only workflows need no generation model. */
  optional?: boolean;
}

export const GENERATION_PROVIDERS = ["openai", "anthropic", "ollama"] as const;

const keyed = (s: OnboardingState, provider: string) =>
  s.serverKeys[provider] === true || s.credentialTypes.some((t) => t.startsWith(`${provider}.`));

export function onboardingSteps(s: OnboardingState): OnboardingStep[] {
  return [
    { id: "decisions", done: keyed(s, "typesafe") },
    {
      id: "generation",
      optional: true,
      done: GENERATION_PROVIDERS.some((p) => keyed(s, p)),
    },
    { id: "workflow", done: s.workflows.length > 0 },
    { id: "run", done: s.hasRun },
    { id: "review", done: s.hasAnsweredTask },
    { id: "publish", done: s.workflows.some((w) => w.latestVersion !== null) },
    { id: "api", done: s.hasApiKey },
  ];
}

/** Required steps done out of required steps; the checklist is complete when they all are. */
export function onboardingProgress(steps: readonly OnboardingStep[]): {
  done: number;
  total: number;
  complete: boolean;
} {
  const required = steps.filter((x) => !x.optional);
  const done = required.filter((x) => x.done).length;
  return { done, total: required.length, complete: done === required.length };
}

/** The step to do next: the first required one not done, else the first optional one. */
export function nextStep(steps: readonly OnboardingStep[]): OnboardingStepId | null {
  return steps.find((x) => !x.done && !x.optional)?.id ?? steps.find((x) => !x.done)?.id ?? null;
}
