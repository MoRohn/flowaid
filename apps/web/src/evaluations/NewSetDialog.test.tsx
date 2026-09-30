import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { installDomStubs } from "@/primitives/testStubs";
import { apiError, bodyOf, callsTo, stubApi, withClient } from "~/knowledge/pageindex/testApi";
import type { WorkflowSummary } from "~/api/types";

vi.mock("~/session", () => ({
  useSession: () => ({ ws: "acme", workspaceName: "Acme", features: {}, can: () => true }),
}));

const { NewSetDialog } = await import("./NewSetDialog");

const KEY = "flowaid:draft:acme:evaluation-set";

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    key: (i: number) => [...data.keys()][i] ?? null,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, String(v)),
    removeItem: (k: string) => void data.delete(k),
    clear: () => data.clear(),
  };
}

beforeAll(() => {
  installDomStubs();
  Object.defineProperty(window, "localStorage", { configurable: true, value: memoryStorage() });
  Object.defineProperty(window, "sessionStorage", { configurable: true, value: memoryStorage() });
});
beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const workflows = [{ id: "wf-1", name: "Support triage" }] as WorkflowSummary[];

const api = (create: () => unknown) => stubApi({ "POST /v1/evaluations/sets": create });

const open = (existingNames: string[] = []) =>
  render(
    withClient(
      <NewSetDialog
        open
        onOpenChange={() => undefined}
        workflows={workflows}
        existingNames={existingNames}
      />,
    ),
  );

const button = (name: RegExp | string) => screen.getByRole<HTMLButtonElement>("button", { name });

describe("new evaluation set, step by step", () => {
  it("names the set, ties it to a workflow and ends on how to fill and run it", async () => {
    const fetchMock = api(() => ({ id: "set-1", name: "Refund routing", workflowId: "wf-1" }));
    open();
    expect(button(/Next: Choose the workflow/).disabled).toBe(true);
    fireEvent.change(screen.getByRole("textbox", { name: /^Name/ }), {
      target: { value: "Refund routing" },
    });
    fireEvent.click(button(/Next: Choose the workflow/));

    act(() => {
      fireEvent.keyDown(screen.getByRole("combobox", { name: /Workflow/ }), { key: "Enter" });
    });
    const item = await screen.findByRole("option", { name: "Support triage" });
    act(() => {
      fireEvent.keyDown(item, { key: "Enter" });
    });
    fireEvent.click(button(/Next: Review and create/));
    expect(screen.getByText(/Tests Support triage/)).toBeTruthy();
    expect(callsTo(fetchMock, "POST /v1/evaluations/sets")).toHaveLength(0);

    fireEvent.click(button("Create set"));
    await waitFor(() => expect(callsTo(fetchMock, "POST /v1/evaluations/sets")).toHaveLength(1));
    expect(bodyOf(callsTo(fetchMock, "POST /v1/evaluations/sets")[0]?.[1])).toEqual({
      name: "Refund routing",
      description: "",
      workflowId: "wf-1",
    });
    expect(await screen.findByText(/Refund routing is created/)).toBeTruthy();
    expect(screen.getByText(/open a finished run of Support triage/)).toBeTruthy();
    expect(screen.getByText(/may cost money/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open Refund routing" }).getAttribute("href")).toBe(
      "/acme/evaluations/sets/set-1",
    );
    expect(window.sessionStorage.getItem(KEY)).toBeNull();
  });

  it("blocks a name another set uses, and keeps the draft when creating fails", async () => {
    const fetchMock = api(() => apiError(500, "INTERNAL", "database unavailable"));
    open(["Refund routing"]);
    fireEvent.change(screen.getByRole("textbox", { name: /^Name/ }), {
      target: { value: "Refund routing" },
    });
    expect(screen.getByText("Another set already has this name")).toBeTruthy();
    expect(button(/Next: Choose the workflow/).disabled).toBe(true);
    expect(button("Create set").disabled).toBe(true);

    fireEvent.change(screen.getByRole("textbox", { name: /^Name/ }), {
      target: { value: "Refund routing v2" },
    });
    fireEvent.click(button("Create set"));
    await waitFor(() => expect(callsTo(fetchMock, "POST /v1/evaluations/sets")).toHaveLength(1));
    expect(await screen.findByText(/database unavailable/)).toBeTruthy();
    expect(screen.getByRole<HTMLInputElement>("textbox", { name: /^Name/ }).value).toBe(
      "Refund routing v2",
    );
    expect(JSON.parse(window.sessionStorage.getItem(KEY) ?? "{}")).toMatchObject({
      name: "Refund routing v2",
    });
  });
});
