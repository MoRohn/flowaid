import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Toaster } from "@flowaid/ui/primitives";
import { installDomStubs } from "@/primitives/testStubs";
import { apiError, bodyOf, callsTo, stubApi } from "~/knowledge/pageindex/testApi";
import type { AgentPreset } from "./logic";

vi.mock("~/session", () => ({
  useSession: () => ({ ws: "acme", workspaceName: "Acme", features: {}, can: () => true }),
}));
const { AgentActiveSwitch } = await import("./AgentActiveSwitch");

beforeAll(() => installDomStubs());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const agent: AgentPreset = {
  id: "a1",
  name: "Order helper",
  description: "",
  config: {},
  active: true,
  createdAt: "",
  updatedAt: "",
};

/** The Agents page's list, as the switch reads and writes it in the cache. */
function renderWithList() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(["agents", "acme"], [agent]);
  const Row = () => {
    const a = qc.getQueryData<AgentPreset[]>(["agents", "acme"])?.[0] ?? agent;
    return <AgentActiveSwitch agent={a} />;
  };
  const view = render(
    <QueryClientProvider client={qc}>
      <Row />
      <Toaster />
    </QueryClientProvider>,
  );
  return {
    qc,
    rerender: () =>
      view.rerender(
        <QueryClientProvider client={qc}>
          <Row />
          <Toaster />
        </QueryClientProvider>,
      ),
  };
}

describe("AgentActiveSwitch", () => {
  it("switches an agent off at once, saves it, and says what that changes", async () => {
    const fetchMock = stubApi({
      "PATCH /v1/agents/a1": () => ({ ...agent, active: false }),
      "GET /v1/agents": () => ({ items: [{ ...agent, active: false }], next_cursor: null }),
    });
    const { qc } = renderWithList();
    expect(screen.getByText("Active")).toBeTruthy();
    act(() => {
      fireEvent.click(screen.getByRole("switch"));
    });
    await waitFor(() =>
      expect(qc.getQueryData<AgentPreset[]>(["agents", "acme"])?.[0]?.active).toBe(false),
    );
    await waitFor(() => expect(callsTo(fetchMock, "PATCH /v1/agents/a1")).toHaveLength(1));
    expect(bodyOf(callsTo(fetchMock, "PATCH /v1/agents/a1")[0]?.[1])).toEqual({ active: false });
    expect(await screen.findByText(/no longer offered in Add node/)).toBeTruthy();
  });

  it("goes back and explains when the server refuses", async () => {
    stubApi({
      "PATCH /v1/agents/a1": () => apiError(403, "FORBIDDEN", "role cannot change agents"),
    });
    const { qc } = renderWithList();
    act(() => {
      fireEvent.click(screen.getByRole("switch"));
    });
    expect(await screen.findByText("Could not deactivate Order helper")).toBeTruthy();
    expect(qc.getQueryData<AgentPreset[]>(["agents", "acme"])?.[0]?.active).toBe(true);
  });
});
