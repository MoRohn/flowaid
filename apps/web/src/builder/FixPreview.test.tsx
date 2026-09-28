import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { WorkflowDefinition } from "@flowaid/workflow-core";
import { installDomStubs } from "@/primitives/testStubs";
import { ReviewTab, toFindingView, useAdvisor, type Advice } from "./advisor";
import { describePatch, patchedDefinition } from "./FixPreview";
import { blankDefinition } from "./model";
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

const advice = (over: Partial<Advice> = {}): Advice => ({
  id: "a1",
  rule: "name_style",
  source: "rubric",
  severity: "warning",
  category: "style",
  title: "Rename the workflow",
  detail: "Names should say what the workflow does.",
  nodeIds: [],
  fix: {
    title: "Rename to Refund triage",
    patch: [{ op: "replace", path: "/name", value: "Refund triage" }],
  },
  ...over,
});

describe("critic findings", () => {
  it("keep who raised them and what the fix is called", () => {
    expect(toFindingView(advice())).toMatchObject({
      source: "rule",
      fixTitle: "Rename to Refund triage",
      fixAvailable: true,
    });
    expect(toFindingView(advice({ source: "judge" })).source).toBe("judge");
  });
});

describe("fix preview", () => {
  it("describes patch operations in words, by node name", () => {
    const def = fresh();
    const end = def.nodes.findIndex((n) => n.id === "end");
    expect(
      describePatch(
        [
          { op: "replace", path: `/nodes/${end}/name`, value: "Reply" },
          { op: "add", path: "/nodes/-", value: { id: "gate", name: "Finance approval" } },
          { op: "remove", path: "/edges/0" },
        ],
        def,
      ),
    ).toEqual([
      { verb: "Set", target: "End › name", value: '"Reply"' },
      { verb: "Add node", target: "Finance approval" },
      { verb: "Remove", target: "edge Start → End" },
    ]);
  });

  it("returns null when the patch no longer applies", () => {
    expect(patchedDefinition(fresh(), [{ op: "remove", path: "/nodes/9" }])).toBeNull();
    expect(patchedDefinition(fresh(), [{ op: "replace", path: "/name", value: "X" }])?.name).toBe(
      "X",
    );
  });
});

function Harness({ store }: { store: BuilderStore }) {
  const advisor = useAdvisor({ workflowId: ID, store, enabled: true });
  return (
    <ReviewTab
      advisor={advisor}
      definition={store.getState().definition}
      onFocusNode={() => undefined}
    />
  );
}

describe("review tab", () => {
  it("shows the source badge and previews a fix before applying it", async () => {
    const store = createBuilderStore({ workflowId: ID, definition: fresh(), draftRevision: 1 });
    post.mockResolvedValue({
      advice: [advice()],
      checks: ["name_style"],
      reviewedAt: new Date().toISOString(),
    });
    render(<Harness store={store} />);
    fireEvent.click(screen.getByRole("button", { name: "Review the draft" }));
    await screen.findByText("Rename the workflow");
    expect(screen.getByText("Rule")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Preview fix" }));
    const group = screen.getByRole("group", { name: "Fix preview: Rename the workflow" });
    expect(group.textContent).toContain("Rename to Refund triage");
    expect(within(group).getByRole("list", { name: "Changes" }).textContent).toContain(
      'Setnameto"Refund triage"',
    );
    // nothing changes until the preview's Apply
    expect(store.getState().definition.name).toBe("Test");
    await act(async () => {
      fireEvent.click(within(group).getByRole("button", { name: "Apply fix" }));
      await Promise.resolve();
    });
    await waitFor(() => expect(store.getState().definition.name).toBe("Refund triage"));
  });
});
