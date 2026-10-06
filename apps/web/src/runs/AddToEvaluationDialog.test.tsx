import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { installDomStubs } from "@/primitives/testStubs";
import { stubApi, withClient } from "~/knowledge/pageindex/testApi";
import { AddToEvaluationDialog } from "./AddToEvaluationDialog";

beforeAll(() => installDomStubs());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const open = () =>
  render(
    withClient(
      <AddToEvaluationDialog
        open
        onOpenChange={() => undefined}
        ws="acme"
        runId="run-1"
        workflowId="wf-1"
        output={null}
      />,
    ),
  );

describe("Add to evaluation", () => {
  it("offers the workflow's sets and the ones tied to none, not other workflows'", async () => {
    stubApi({
      "GET /v1/evaluations/sets": () => ({
        items: [
          { id: "s-any", name: "Smoke", workflowId: null },
          { id: "s-own", name: "Triage regression", workflowId: "wf-1" },
          { id: "s-other", name: "Billing", workflowId: "wf-2" },
        ],
        next_cursor: null,
      }),
      "GET /v1/evaluations/sets/s-own/cases": () => ({ items: [], next_cursor: null }),
    });
    open();
    const select = await screen.findByRole("combobox", { name: /Evaluation set/ });
    await waitFor(() => expect((select as HTMLButtonElement).disabled).toBe(false));
    act(() => {
      fireEvent.keyDown(select, { key: "Enter" });
    });
    const options = (await screen.findAllByRole("option")).map((o) => o.textContent);
    expect(options.some((t) => t?.includes("Triage regression"))).toBe(true);
    expect(options.some((t) => t?.includes("Smoke"))).toBe(true);
    expect(options.some((t) => t?.includes("Billing"))).toBe(false);
  });

  it("will not add a run the set already holds", async () => {
    const fetchMock = stubApi({
      "GET /v1/evaluations/sets": () => ({
        items: [{ id: "s-own", name: "Triage regression", workflowId: "wf-1" }],
        next_cursor: null,
      }),
      "GET /v1/evaluations/sets/s-own/cases": () => ({
        items: [{ ordinal: 2, sourceRunId: "run-1" }],
        next_cursor: null,
      }),
    });
    open();
    expect(await screen.findByText("This run is already case 3 of the set.")).toBeTruthy();
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Add case" }).disabled).toBe(true);
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
  });
});
