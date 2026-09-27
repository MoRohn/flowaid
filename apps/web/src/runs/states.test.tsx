import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { installDomStubs } from "@/primitives/testStubs";
import type { NodeRunView, RunView } from "@flowaid/ui";
import ExternalReview from "../../app/review/page";
import { CostPanel } from "./CostPanel";
import { NodeRunPanel } from "./NodeRunPanel";
import { ResolvedTasksTable } from "./ResolvedTasksTable";

beforeAll(() => installDomStubs());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  sessionStorage.clear();
  window.history.replaceState(null, "", "/");
});

const TOKEN = "jrgmoNaNvCn8IkeifDfhEBhIybgBDfu7SNRHs4-DcI0";
const json = (status: number, body: unknown) =>
  Promise.resolve(
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }),
  );

describe("external review page", () => {
  it("asks for a link when there is no token", async () => {
    vi.stubGlobal("fetch", vi.fn());
    render(<ExternalReview />);
    expect(await screen.findByText("This page needs a review link")).toBeTruthy();
  });

  it("explains an expired, used or revoked link", async () => {
    window.history.replaceState(null, "", `/review#t=${TOKEN}`);
    vi.stubGlobal(
      "fetch",
      vi.fn(() => json(404, { error: { code: "NOT_FOUND" } })),
    );
    render(<ExternalReview />);
    expect(await screen.findByText("This review link no longer works")).toBeTruthy();
  });

  it("clears the fragment, sends the token as a bearer header and records the answer", async () => {
    window.history.replaceState(null, "", `/review#t=${TOKEN}`);
    const fetch = vi.fn((path: string, init?: RequestInit) =>
      path === "/v1/review"
        ? json(200, {
            title: "Approve the refund",
            mode: { type: "approval" },
            context: { note: "Refund 42 USD" },
            expiresAt: "2099-01-01T00:00:00.000Z",
            workflowName: "Refunds",
          })
        : json(202, { status: "responded", _init: init?.body }),
    );
    vi.stubGlobal("fetch", fetch);
    render(<ExternalReview />);
    expect(
      await screen.findByText("Approve the refund", { selector: "h2, h3, p, span, div" }),
    ).toBeTruthy();
    expect(window.location.hash).toBe("");
    const [path, init] = fetch.mock.calls[0] as [string, RequestInit];
    expect(path).toBe("/v1/review");
    expect((init.headers as Record<string, string>).authorization).toBe(`Bearer ${TOKEN}`);
    expect(init.credentials).toBe("omit");
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: /^Approve/ }));
    });
    await waitFor(() =>
      expect(screen.getByText("Thank you, your response was recorded")).toBeTruthy(),
    );
    const [respondPath, respondInit] = fetch.mock.calls[1] as [string, RequestInit];
    expect(respondPath).toBe("/v1/review/respond");
    expect(JSON.parse(respondInit.body as string)).toMatchObject({
      response: { action: "approve" },
    });
    expect(sessionStorage.getItem("flowaid:review-token")).toBeNull();
  });
});

const nodeRun: NodeRunView = {
  id: "nr1",
  nodeId: "fetch",
  nodeName: "Fetch order",
  nodeType: "flowaid.tools.http",
  category: "tool",
  status: "failed",
  attempt: 2,
  error: { code: "TOOL_EXECUTION_ERROR", message: "upstream failed", retryable: true },
  output: { partial: true },
};

describe("node run detail", () => {
  it("shows the error, attempts and output", () => {
    render(
      <NodeRunPanel
        nodeRun={nodeRun}
        attempts={[{ ...nodeRun, id: "nr0", attempt: 1 }, nodeRun]}
        streamed="Hello"
        partial
      />,
    );
    expect(screen.getByRole("alert").textContent).toContain("upstream failed");
    expect(screen.getByText("Attempts")).toBeTruthy();
    expect(screen.getByText("Stream resumed, partial text unavailable.")).toBeTruthy();
  });
});

describe("empty states", () => {
  it("cost panel without metered usage", () => {
    render(<CostPanel run={{ nodeRuns: [], costUsd: 0 } as unknown as RunView} />);
    expect(screen.getByText("No metered usage")).toBeTruthy();
  });

  it("resolved tasks without rows", () => {
    render(
      <ResolvedTasksTable
        tasks={[]}
        workflowNames={new Map()}
        members={[]}
        onOpen={() => undefined}
        emptyState={<p>Nothing resolved yet</p>}
      />,
    );
    expect(screen.getByText("Nothing resolved yet")).toBeTruthy();
  });
});
