import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { NodeManifest, WorkflowDefinition } from "@flowaid/workflow-core";
import { installDomStubs } from "@/primitives/testStubs";
import { CostTab, advisorAvailability, toCostView, useAdvisor, type Suggestion } from "./advisor";
import { planFromGenerated } from "./aiPlan";
import { Catalog, blankDefinition } from "./model";
import { createBuilderStore, type BuilderStore } from "./store";

const post = vi.hoisted(() => vi.fn());
vi.mock("~/api/client", async (actual) => ({
  ...(await actual<Record<string, unknown>>()),
  post,
}));

beforeAll(() => installDomStubs());
afterEach(() => {
  cleanup();
  post.mockReset();
});

const ID = "3e7a1c9b-8d2f-4b6e-9a0c-5f4d3e2b1a09";
const fresh = (): WorkflowDefinition => blankDefinition(ID, "Test");
const storeOf = () => createBuilderStore({ workflowId: ID, definition: fresh(), draftRevision: 1 });

const DECISION: NodeManifest = {
  id: "flowaid.decision.boolean",
  version: "1.0.0",
  metadata: { name: "Yes/No", description: "", category: "decision", icon: "split", tags: [] },
  configSchema: { type: "object" },
  inputs: [],
  outputs: [],
  controlPorts: [],
  portRules: [],
  credentials: [],
  capabilities: [],
  idempotency: { default: "safe" } as unknown as NodeManifest["idempotency"],
  pool: "general",
  generation: false,
  streams: false,
  optionProviders: [],
  migrations: [],
  defaultPolicy: {},
};

const rename = (name: string): Suggestion => ({
  id: "tighten_bounds:x",
  kind: "tighten_bounds",
  nodeIds: [],
  title: `Rename to ${name}`,
  rationale: "shorter",
  estimatedSavingsUsdPerRun: 0.001,
  currentCostUsdPerRun: 0.004,
  latencyDeltaMs: -10,
  risk: "low",
  qualityImpact: "None.",
  fix: [{ op: "replace", path: "/name", value: name }],
});

describe("builder store: applyPatch", () => {
  it("applies RFC 6902 operations as one undoable edit and remounts the forms", () => {
    const s = storeOf();
    const epoch = s.getState().epoch;
    expect(
      s.getState().applyPatch(
        [
          { op: "replace", path: "/name", value: "Cheaper" },
          { op: "add", path: "/execution/maxCostUsd", value: 0.25 },
        ],
        "Tighten the cost bound",
      ),
    ).toBe(true);
    expect(s.getState().definition.name).toBe("Cheaper");
    expect(s.getState().definition.execution.maxCostUsd).toBe(0.25);
    expect(s.getState().epoch).toBeGreaterThan(epoch);
    expect(s.getState().history.past.at(-1)?.label).toBe("Tighten the cost bound");
    s.getState().undo();
    expect(s.getState().definition).toEqual(fresh());
    s.getState().redo();
    expect(s.getState().definition.name).toBe("Cheaper");
  });

  it("refuses a patch that no longer applies, leaving the draft and history alone", () => {
    const s = storeOf();
    const ok = s
      .getState()
      .applyPatch([{ op: "remove", path: "/nodes/99" }], "Batch two decisions");
    expect(ok).toBe(false);
    expect(s.getState().definition).toEqual(fresh());
    expect(s.getState().history.past).toEqual([]);
    expect(s.getState().notice?.message).toMatch(/Batch two decisions/);
  });
});

describe("advisor availability", () => {
  it("shows nothing when the server reports the features off", () => {
    expect(advisorAvailability({}, true)).toEqual({ advisor: false, aiBuilder: false });
    expect(advisorAvailability({ advisor: false, ai_builder: false }, true)).toEqual({
      advisor: false,
      aiBuilder: false,
    });
  });
  it("gates the AI builder on a generation model and on write access", () => {
    expect(advisorAvailability({ advisor: true, ai_builder: true }, true)).toEqual({
      advisor: true,
      aiBuilder: true,
    });
    expect(advisorAvailability({ advisor: true, ai_builder: true }, false).aiBuilder).toBe(false);
    expect(advisorAvailability({ advisor: true }, true).aiBuilder).toBe(false);
  });
});

describe("advisor views", () => {
  it("maps a suggestion to per-1k costs", () => {
    const v = toCostView(rename("A"), fresh(), new Catalog([]));
    expect(v.beforeCostPer1k).toBeCloseTo(4, 9);
    expect(v.afterCostPer1k).toBeCloseTo(3, 9);
    expect(v.kind).toBe("rule");
  });

  it("reads the AI builder's definition as a plan", () => {
    const def = fresh();
    def.nodes.splice(1, 0, {
      id: "is_refund",
      kind: "task",
      name: "Is refund",
      type: "flowaid.decision.boolean",
      typeVersion: "1.0.0",
      config: { instructions: "Is this a refund request?" },
      inputs: {},
      credentials: {},
      disabled: false,
    });
    const plan = planFromGenerated(
      {
        definition: def,
        diagnostics: [],
        rationale: "One decision.",
        iterations: 1,
        model: { provider: "fake", model: "m" },
        usage: { inputTokens: 1, outputTokens: 1 },
        costUsd: 0,
      },
      [DECISION],
    );
    expect(plan.outcome).toBe("One decision.");
    expect(plan.decisions).toEqual([
      { id: "is_refund", kind: "boolean", question: "Is this a refund request?" },
    ]);
    expect(plan.steps).toEqual(["Is refund"]);
    expect(plan.workflow?.nodes.find((n) => n.id === "is_refund")?.category).toBe("decision");
  });
});

function Harness({ store }: { store: BuilderStore }) {
  const advisor = useAdvisor({ workflowId: ID, store, enabled: true });
  return <CostTab advisor={advisor} definition={fresh()} catalog={new Catalog([])} />;
}

describe("cost tab", () => {
  it("fetches suggestions, then applies the chosen fix through the store", async () => {
    const store = storeOf();
    const answer = (s: Suggestion[]) =>
      Promise.resolve({
        suggestions: s,
        diagnostics: [],
        window: { days: 30, from: "", runs: 40 },
      });
    post.mockImplementation(() => answer([rename("Cheaper")]));
    render(<Harness store={store} />);
    fireEvent.click(screen.getByRole("button", { name: "Find savings" }));
    await screen.findByText("Rename to Cheaper");
    expect(post).toHaveBeenCalledWith(`/v1/workflows/${ID}/optimize`, {
      definition: store.getState().definition,
    });
    post.mockImplementation(() => answer([]));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Apply selected/ }));
      await Promise.resolve();
    });
    await waitFor(() => expect(store.getState().definition.name).toBe("Cheaper"));
    store.getState().undo();
    expect(store.getState().definition.name).toBe("Test");
  });
});
