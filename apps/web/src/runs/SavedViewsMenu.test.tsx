import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { installDomStubs } from "@/primitives/testStubs";
import { SavedViewsMenu, type SavedView } from "./SavedViewsMenu";

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), del: vi.fn() }));
vi.mock("~/api/client", async (actual) => ({
  ...(await actual<Record<string, unknown>>()),
  ...api,
}));

beforeAll(() => installDomStubs());
afterEach(() => {
  cleanup();
  api.get.mockReset();
  api.post.mockReset();
  api.del.mockReset();
});

const VIEWS: SavedView[] = [
  { id: "a", scope: "runs", name: "Failed", filters: { query: "status=failed" } },
];

const open = (el: HTMLElement) =>
  act(() => {
    fireEvent.keyDown(el, { key: "Enter" });
  });
const click = (el: HTMLElement) =>
  act(() => {
    fireEvent.click(el);
  });

const renderMenu = (query: string, onApply = vi.fn()) => {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <SavedViewsMenu ws="default" query={query} onApply={onApply} />
    </QueryClientProvider>,
  );
  return onApply;
};

describe("SavedViewsMenu", () => {
  it("names the view the filters match and applies another", async () => {
    api.get.mockResolvedValue(VIEWS);
    const onApply = renderMenu("status=failed");
    const trigger = await screen.findByRole("button", { name: "Saved views" });
    await waitFor(() => expect(trigger.textContent).toContain("Failed"));
    open(trigger);
    click(await screen.findByRole("menuitem", { name: /Failed/ }));
    expect(onApply).toHaveBeenCalledWith("status=failed");
  });

  it("saves the current filters under a name", async () => {
    api.get.mockResolvedValue([]);
    api.post.mockResolvedValue({ ...VIEWS[0], name: "Mine" });
    renderMenu("origin=webhook");
    open(await screen.findByRole("button", { name: "Saved views" }));
    click(await screen.findByRole("menuitem", { name: /Save current filters/ }));
    const input = await screen.findByLabelText(/Name/);
    act(() => {
      fireEvent.change(input, { target: { value: "Mine" } });
    });
    click(screen.getByRole("button", { name: "Save view" }));
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith("/v1/saved-views", {
        scope: "runs",
        name: "Mine",
        filters: { query: "origin=webhook" },
      }),
    );
  });
});
