import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { installDomStubs } from "@/primitives/testStubs";
import { apiError, bodyOf, callsTo, stubApi, withClient } from "~/knowledge/pageindex/testApi";

vi.mock("~/session", () => ({
  useSession: () => ({
    ws: "acme",
    workspaceName: "Acme",
    environments: [{ id: "env-dev", name: "dev", protected: false }],
    features: { schedules: true },
    can: () => true,
  }),
}));

const { AddTriggerDialog } = await import("./AddTriggerDialog");

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

const detail = {
  id: "wf-1",
  name: "Refund desk",
  slug: "refund-desk",
  draftRevision: 3,
  latestVersion: 2,
  deployments: [{ environmentId: "env-dev", environment: "dev", version: 2 }],
  draft: {
    name: "Refund desk",
    triggers: [{ type: "manual" }],
    inputs: {
      type: "object",
      properties: { email: { type: "string" }, message: { type: "string" } },
      required: ["email"],
    },
  },
};

const button = (name: RegExp | string) => screen.getByRole<HTMLButtonElement>("button", { name });

describe("adding a webhook, step by step", () => {
  it("chooses the workflow, warns about a taken path, and only writes the draft", async () => {
    const fetchMock = stubApi({
      "GET /v1/workflows": () => ({ items: [{ id: "wf-1", name: "Refund desk" }] }),
      "GET /v1/workflows/wf-1": () => detail,
      "GET /v1/webhooks": () => ({
        items: [{ workflowId: "wf-2", path: "dev/refund-desk" }],
        next_cursor: null,
      }),
      "PUT /v1/workflows/wf-1/draft": () => ({ ok: true }),
    });
    render(withClient(<AddTriggerDialog kind="webhook" open onOpenChange={() => undefined} />));
    expect(button(/Next: Name the URL/).disabled).toBe(true);
    act(() => {
      fireEvent.keyDown(screen.getByRole("combobox", { name: /Workflow/ }), { key: "Enter" });
    });
    const item = await screen.findByRole("option", { name: "Refund desk" });
    act(() => {
      fireEvent.keyDown(item, { key: "Enter" });
    });
    expect(await screen.findByText("Deployed to dev")).toBeTruthy();

    fireEvent.click(button(/Next: Name the URL/));
    expect(screen.getByLabelText<HTMLInputElement>(/^Path/).value).toBe("refund-desk");
    const rail = screen.getByRole("navigation", { name: "Steps" });
    fireEvent.click(within(rail).getByRole("button", { name: /Review and add/ }));
    await waitFor(() =>
      expect(screen.getByText(/Another workflow already uses \/refund-desk in dev/)).toBeTruthy(),
    );
    expect(screen.getByText(/Callers must send a JSON body with email/)).toBeTruthy();
    expect(screen.getByText(/Live now in dev \(v2\)/)).toBeTruthy();

    fireEvent.click(within(rail).getByRole("button", { name: /Name the URL/ }));
    fireEvent.change(screen.getByLabelText(/^Path/), { target: { value: "refunds-in" } });
    fireEvent.click(button("Add to the draft"));
    await waitFor(() => expect(callsTo(fetchMock, "PUT /v1/workflows/wf-1/draft")).toHaveLength(1));
    const [, init] = callsTo(fetchMock, "PUT /v1/workflows/wf-1/draft")[0] ?? [];
    expect(new Headers(init?.headers).get("if-match")).toBe('"3"');
    expect(bodyOf(init)).toMatchObject({
      definition: {
        triggers: [
          { type: "manual" },
          { type: "webhook", path: "refunds-in", signature: "hmac_sha256", responseMode: "async" },
        ],
      },
    });
    expect(await screen.findByText(/Added to Refund desk's draft/)).toBeTruthy();
    expect(screen.getByText(/nothing was published or deployed/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Deployments" }).getAttribute("href")).toBe(
      "/acme/workflows/wf-1/deployments",
    );
    // nothing but reads and the one draft write
    expect(
      fetchMock.mock.calls.filter(([, i]) => (i?.method ?? "GET") !== "GET").map(([u]) => u),
    ).toEqual(["/v1/workflows/wf-1/draft"]);
    expect(window.sessionStorage.getItem("flowaid:draft:acme:trigger:webhook")).toBeNull();
  });
});

describe("adding a schedule, all fields at once", () => {
  it("blocks a bad time zone, and keeps the draft when saving fails", async () => {
    window.localStorage.setItem("flowaid:guided-mode", "all");
    let reads = 0;
    const fetchMock = stubApi({
      "GET /v1/workflows/wf-1": () => {
        reads += 1;
        return detail;
      },
      "PUT /v1/workflows/wf-1/draft": () =>
        apiError(412, "PRECONDITION_FAILED", "the draft changed since revision 3."),
    });
    render(
      withClient(
        <AddTriggerDialog kind="schedule" workflowId="wf-1" open onOpenChange={() => undefined} />,
      ),
    );
    const tz = await screen.findByLabelText(/^Time zone/);
    fireEvent.change(tz, { target: { value: "Mars/Base" } });
    await waitFor(() => expect(button("Add to the draft").disabled).toBe(true));
    expect(screen.getAllByText(/Mars\/Base is not a time zone/).length).toBeGreaterThan(0);

    fireEvent.change(tz, { target: { value: "UTC" } });
    fireEvent.click(button("Fill in an example to edit"));
    expect(screen.getByLabelText<HTMLTextAreaElement>(/^Input/).value).toContain("example email");
    await waitFor(() => expect(button("Add to the draft").disabled).toBe(false));
    fireEvent.click(button("Add to the draft"));
    expect(await screen.findByText(/was not added: the draft changed/)).toBeTruthy();
    expect(callsTo(fetchMock, "PUT /v1/workflows/wf-1/draft")).toHaveLength(1);
    // the draft is reloaded for the next attempt, and what was entered is kept
    await waitFor(() => expect(reads).toBeGreaterThan(1));
    const kept = JSON.parse(
      window.sessionStorage.getItem("flowaid:draft:acme:trigger:schedule:wf-1") ?? "{}",
    ) as { timezone?: string; input?: string };
    expect(kept.timezone).toBe("UTC");
    expect(kept.input).toContain("example email");
  });
});
