import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { installDomStubs } from "@/primitives/testStubs";
import { stubApi, withClient } from "~/knowledge/pageindex/testApi";

let search = "";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/acme/runs",
  useSearchParams: () => new URLSearchParams(search),
}));
vi.mock("~/session", () => ({
  useSession: () => ({ ws: "acme", environments: [], features: {}, can: () => true }),
}));
const { RunsList } = await import("./RunsList");

beforeAll(() => installDomStubs());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  search = "";
});

const run = (id: string, version: number | null) => ({
  id,
  workspaceId: "ws",
  workflowId: "wf1",
  workflowVersionId: `v-${String(version)}`,
  environmentId: "env",
  status: "completed",
  origin: "ui",
  mode: "async",
  input: {},
  output: null,
  outcome: null,
  error: null,
  parentRunId: null,
  sourceRunId: null,
  sessionId: null,
  labels: {},
  lastSeq: 9,
  usage: null,
  costUsd: 0,
  nodeRunCount: 2,
  decisions: [],
  version,
  createdAt: "2026-10-05T10:00:00.000Z",
  startedAt: "2026-10-05T10:00:00.000Z",
  endedAt: "2026-10-05T10:00:01.000Z",
});

function stubRuns(items: unknown[], next: string | null) {
  return stubApi({
    "GET /v1/runs": () => ({ items, next_cursor: next }),
    "GET /v1/workflows": () => ({ items: [{ id: "wf1", name: "Refunds" }], next_cursor: null }),
    "GET /v1/saved-views": () => ({ items: [], next_cursor: null }),
  });
}

describe("RunsList", () => {
  it("asks the API to search and limit the time over every run, with versions in one request", async () => {
    search = "q=01a10cfc&range=7d";
    const fetchMock = stubRuns([run("01a10cfc-0000-7000-8000-000000000001", 3)], "next");
    render(withClient(<RunsList />));
    expect(await screen.findByText("1 run loaded")).toBeTruthy();
    const urls = fetchMock.mock.calls.map(([u]) => u);
    const list = new URL(urls.find((u) => u.startsWith("/v1/runs?")) as string, "http://x");
    expect(list.searchParams.get("q")).toBe("01a10cfc");
    expect(list.searchParams.get("from")).toMatch(/^\d{4}-\d\d-\d\dT/);
    expect(list.searchParams.get("include")).toBe("decisions,version");
    // version numbers came with the runs: no request per workflow
    expect(urls.some((u) => u.includes("/versions"))).toBe(false);
    expect(screen.getByText("v3")).toBeTruthy();
  });

  it("says when nothing among the loaded runs matches and older runs exist", async () => {
    search = "origin=api,schedule";
    stubRuns([run("01a10cfc-0000-7000-8000-000000000001", null)], "next");
    render(withClient(<RunsList />));
    expect(await screen.findByText("No loaded runs match these filters")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Load older runs" })).toBeTruthy();
  });

  it("counts plainly once every run is loaded", async () => {
    stubRuns([run("01a10cfc-0000-7000-8000-000000000001", 1)], null);
    render(withClient(<RunsList />));
    await waitFor(() => expect(screen.getByText("1 run")).toBeTruthy());
  });
});
