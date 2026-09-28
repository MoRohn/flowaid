import { describe, expect, it } from "vitest";
import { nextStep, onboardingProgress, onboardingSteps, type OnboardingState } from "./steps";

const empty: OnboardingState = {
  serverKeys: {},
  credentialTypes: [],
  workflows: [],
  hasRun: false,
  hasAnsweredTask: false,
  hasApiKey: false,
};
const done = (s: OnboardingState) =>
  Object.fromEntries(onboardingSteps(s).map((x) => [x.id, x.done]));

describe("getting started", () => {
  it("starts with nothing done and points at the decision key", () => {
    const steps = onboardingSteps(empty);
    expect(steps.every((x) => !x.done)).toBe(true);
    expect(onboardingProgress(steps)).toEqual({ done: 0, total: 6, complete: false });
    expect(nextStep(steps)).toBe("decisions");
  });

  it("counts a server key from the environment or a workspace credential", () => {
    expect(done({ ...empty, serverKeys: { typesafe: true } }).decisions).toBe(true);
    expect(done({ ...empty, credentialTypes: ["typesafe.api_key"] }).decisions).toBe(true);
    expect(done({ ...empty, credentialTypes: ["anthropic.api_key"] }).generation).toBe(true);
    expect(done({ ...empty, serverKeys: { ollama: true } }).generation).toBe(true);
    expect(done({ ...empty, serverKeys: { typesafe: false } }).decisions).toBe(false);
  });

  it("follows the workspace: workflows, runs, answered tasks, versions and API keys", () => {
    const s: OnboardingState = {
      serverKeys: { typesafe: true },
      credentialTypes: [],
      workflows: [
        { id: "a", latestVersion: null },
        { id: "b", latestVersion: 2 },
      ],
      hasRun: true,
      hasAnsweredTask: true,
      hasApiKey: true,
    };
    const steps = onboardingSteps(s);
    // the optional generation step does not hold the checklist back
    expect(onboardingProgress(steps)).toEqual({ done: 6, total: 6, complete: true });
    expect(nextStep(steps)).toBe("generation");
    expect(nextStep(onboardingSteps({ ...s, serverKeys: { typesafe: true, openai: true } }))).toBe(
      null,
    );
    expect(done({ ...s, workflows: [{ id: "a", latestVersion: null }] }).publish).toBe(false);
  });
});
