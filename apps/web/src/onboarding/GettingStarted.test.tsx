import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { installDomStubs } from "@/primitives/testStubs";

const push = vi.fn();
let search = "";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(search),
}));
vi.mock("~/session", () => ({
  useSession: () => ({ ws: "default", local: true, can: () => true, features: {} }),
}));
const responses: Record<string, unknown> = {};
vi.mock("~/api/client", () => ({
  get: (path: string) => Promise.resolve(responses[path.split("?")[0] as string]),
  getAll: (path: string) =>
    Promise.resolve((responses[path.split("?")[0] as string] as { items: unknown[] }).items),
}));

import { GettingStarted } from "./GettingStarted";

beforeAll(() => {
  installDomStubs();
  // a plain in-memory Storage (Node's own `localStorage` global shadows jsdom's)
  const data = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, String(v)),
      removeItem: (k: string) => void data.delete(k),
      clear: () => data.clear(),
    },
  });
});
afterEach(cleanup);
beforeEach(() => {
  window.localStorage.clear();
  search = "";
  push.mockReset();
  Object.assign(responses, {
    "/v1/providers": [{ id: "typesafe", configuredOnServer: true }],
    "/v1/credentials": { items: [], next_cursor: null },
    "/v1/workflows": { items: [{ id: "w1", latestVersion: null }], next_cursor: null },
    "/v1/runs": { items: [], next_cursor: null },
    "/v1/human-tasks": { items: [], next_cursor: null },
    "/v1/api-keys": { items: [], next_cursor: null },
  });
});

const view = () =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <GettingStarted />
    </QueryClientProvider>,
  );

describe("GettingStarted", () => {
  it("ticks steps off from the workspace and points at the next one", async () => {
    view();
    const list = await screen.findByRole("list");
    expect(screen.getByText("2 of 6 required done")).toBeTruthy();
    const current = within(list)
      .getAllByRole("listitem")
      .find((li) => li.getAttribute("aria-current") === "step");
    expect(current?.textContent).toContain("Run it");
    fireEvent.click(
      within(current as HTMLElement).getByRole("button", { name: "Open the workflow" }),
    );
    expect(push).toHaveBeenCalledWith("/default/workflows/w1");
  });

  it("hides for this browser and comes back from the help menu's link", async () => {
    const { unmount } = view();
    fireEvent.click(await screen.findByRole("button", { name: "Hide getting started" }));
    expect(screen.queryByText("Get started with FlowAId")).toBeNull();
    unmount();
    view();
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByText("Get started with FlowAId")).toBeNull();
    cleanup();
    search = "getting-started";
    view();
    expect(await screen.findByText("Get started with FlowAId")).toBeTruthy();
  });
});
