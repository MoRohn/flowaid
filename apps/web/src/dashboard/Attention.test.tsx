import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { installDomStubs } from "@/primitives/testStubs";
import { Attention } from "./Attention";
import type { InsightsReport } from "./insights";

beforeAll(() => installDomStubs());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const NOW = Date.parse("2026-09-28T12:00:00Z");
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const REPORT: InsightsReport = {
  computedAt: "2026-09-28T11:58:00.000Z",
  window: { from: "2026-09-21T12:00:00.000Z", to: "2026-09-28T12:00:00.000Z" },
  baseline: { from: "2026-08-24T12:00:00.000Z", to: "2026-09-21T12:00:00.000Z" },
  attention: {
    openApprovals: { count: 2, oldestAt: "2026-09-26T12:00:00.000Z", expiringSoon: 1 },
    failingWorkflows: [
      { workflowId: "wf-1", workflowName: "Support triage", failed: 20, finished: 40 },
    ],
  },
  insights: [
    {
      id: "failure_rate:wf-1",
      kind: "failure_rate",
      severity: "critical",
      workflowId: "wf-1",
      workflowName: "Support triage",
      title: "Support triage fails more often since a new version",
      summary: "50.0% of 40 finished runs failed, against 3.3% of 60 before.",
      evidence: {
        metric: "failure rate of finished runs",
        recent: { value: 0.5, n: 40 },
        baseline: { value: 0.033, n: 60 },
        effect: { points: 46.7 },
        test: "fisher_exact",
        pValue: 0.0001,
        qValue: 0.0004,
      },
      attribution: { versionId: "v2", version: 2, share: 1 },
    },
  ],
};

function mount(response: () => Response, props: Partial<Parameters<typeof Attention>[0]> = {}) {
  const fetch = vi.fn((_url: string) => Promise.resolve(response()));
  vi.stubGlobal("fetch", fetch);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <Attention ws="default" window="7d" now={() => NOW} {...props} />
    </QueryClientProvider>,
  );
  return fetch;
}

describe("Attention", () => {
  it("lists what needs a person, with links to act", async () => {
    const fetch = mount(() => json(REPORT), { workflowId: "wf-1" });
    const list = await screen.findByRole("list", { name: "Needs attention" });
    const approvals = within(list).getByRole("link", { name: /2 approvals are waiting/ });
    expect(approvals.getAttribute("href")).toBe("/default/human-tasks");
    expect(approvals.textContent).toContain("oldest 2 days ago · 1 expires within a day");
    const failing = within(list).getByRole("link", { name: /Support triage/ });
    expect(failing.getAttribute("href")).toContain("/default/runs?");
    expect(failing.getAttribute("href")).toContain("status=failed");
    expect(String(fetch.mock.calls[0]?.[0])).toContain("/v1/insights?window=7d&workflowId=wf-1");
  });

  it("shows what changed with the version it coincides with and the evidence", async () => {
    mount(() => json(REPORT));
    const changes = await screen.findByRole("list", { name: "What changed" });
    expect(within(changes).getByText("Critical")).toBeTruthy();
    expect(within(changes).getByText(/Version 2 ran 100% of the recent runs/)).toBeTruthy();
    expect(within(changes).getByText(/not proven to cause it/)).toBeTruthy();
    expect(within(changes).getByText("Evidence")).toBeTruthy();
    expect(within(changes).getByText(/Fisher's exact test/)).toBeTruthy();
    expect(within(changes).getByRole("link", { name: "Versions" }).getAttribute("href")).toBe(
      "/default/workflows/wf-1/versions",
    );
    expect(screen.getByText(/Last 7 days against the 4 weeks before/)).toBeTruthy();
    expect(screen.getByText(/computed 2 minutes ago/)).toBeTruthy();
  });

  it("says when nothing needs attention and nothing changed", async () => {
    mount(() =>
      json({
        ...REPORT,
        attention: {
          openApprovals: { count: 0, oldestAt: null, expiringSoon: 0 },
          failingWorkflows: [],
        },
        insights: [],
      }),
    );
    expect(await screen.findByText(/Nothing is waiting for you/)).toBeTruthy();
    expect(screen.getByText(/No significant change/)).toBeTruthy();
  });

  it("stays out of the way when insights are unavailable", async () => {
    mount(() => json({ error: { code: "INTERNAL", message: "boom" } }, 500));
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByText("Needs attention")).toBeNull();
  });
});
