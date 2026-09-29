import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { installDomStubs } from "@/primitives/testStubs";
import { recordAppWindow } from "./appWindow";
import { trayPlace, useDesktop } from "./desktop";

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock("~/api/client", async (actual) => ({
  ...(await actual<Record<string, unknown>>()),
  ...api,
}));

beforeAll(() => installDomStubs());
afterEach(() => {
  cleanup();
  api.get.mockReset();
  api.post.mockReset();
  vi.restoreAllMocks();
  window.sessionStorage.clear();
});

/** This page is FlowAId's own window: the launcher opened it at /#flowaid-window. */
const asAppWindow = () => {
  window.history.replaceState(null, "", "/#flowaid-window");
  recordAppWindow();
};

const open = (el: HTMLElement) =>
  act(() => {
    fireEvent.keyDown(el, { key: "Enter" });
  });
const click = (el: HTMLElement) =>
  act(() => {
    fireEvent.click(el);
  });

function Harness({ desktop, admin }: { desktop: boolean; admin: boolean }) {
  const d = useDesktop({ features: { desktop }, can: () => admin });
  return (
    <>
      <span data-testid="commands">{d.commands.map((c) => c.label).join(" | ")}</span>
      {d.menu}
      {d.overlay}
    </>
  );
}

const renderDesktop = (
  o: {
    desktop?: boolean;
    admin?: boolean;
    window?: string;
    activity?: { runs: number; approvals: number };
  } = {},
) => {
  api.get.mockResolvedValue({
    window: o.window ?? "app",
    tray: true,
    platform: "macos",
    activity: o.activity ?? { runs: 0, approvals: 0 },
  });
  render(
    <QueryClientProvider client={new QueryClient()}>
      <Harness desktop={o.desktop ?? true} admin={o.admin ?? true} />
    </QueryClientProvider>,
  );
};
const menu = () => screen.findByRole("button", { name: "Close or quit FlowAId" });

describe("Close window and Quit FlowAId", () => {
  it("is absent when no launcher runs FlowAId (Docker Compose, a server)", () => {
    renderDesktop({ desktop: false });
    expect(screen.queryByRole("button", { name: "Close or quit FlowAId" })).toBeNull();
    expect(screen.getByTestId("commands").textContent).toBe("");
    expect(api.get).not.toHaveBeenCalled();
  });

  it("offers both in the menu and the command menu, saying where the icon is", async () => {
    renderDesktop();
    expect(screen.getByTestId("commands").textContent).toBe("Close window | Quit FlowAId…");
    await waitFor(() => expect(api.get).toHaveBeenCalledWith("/v1/desktop"));
    open(await menu());
    const close = await screen.findByRole("menuitem", { name: /Close window/ });
    await waitFor(() => expect(close.textContent).toContain("reopen it from the menu bar"));
    expect(screen.getByRole("menuitem", { name: /Quit FlowAId/ })).toBeTruthy();
  });

  it("records FlowAId's own window and drops the marker from the address", () => {
    asAppWindow();
    expect(window.location.hash).toBe("");
    expect(window.location.pathname).toBe("/");
    expect(window.sessionStorage.getItem("flowaid:app-window")).toBe("1");
  });

  it("lets the launcher close FlowAId's own window", async () => {
    asAppWindow();
    api.post.mockResolvedValue({ closed: true });
    const closeSpy = vi.spyOn(window, "close").mockImplementation(() => undefined);
    renderDesktop();
    open(await menu());
    click(await screen.findByRole("menuitem", { name: /Close window/ }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith("/v1/desktop/window/close"));
    expect(closeSpy).not.toHaveBeenCalled();
    expect(screen.queryByText("FlowAId is still running")).toBeNull();
  });

  it("says how to come back when a browser tab cannot be closed by the page", async () => {
    const closeSpy = vi.spyOn(window, "close").mockImplementation(() => undefined);
    // another tab on the same address, while the launcher's app window is open too
    renderDesktop({ window: "app" });
    open(await menu());
    click(await screen.findByRole("menuitem", { name: /Close window/ }));
    await screen.findByText("FlowAId is still running", undefined, { timeout: 2000 });
    expect(closeSpy).toHaveBeenCalled();
    // it closes only itself: never FlowAId's own window
    expect(api.post).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog").textContent).toContain("from its icon in the menu bar");
    click(screen.getByRole("button", { name: "Back to FlowAId" }));
    expect(screen.queryByText("FlowAId is still running")).toBeNull();
  });

  it("quits only after confirming, then says FlowAId has stopped", async () => {
    api.post.mockResolvedValue({ stopping: true });
    renderDesktop({ window: "browser", activity: { runs: 2, approvals: 1 } });
    open(await menu());
    click(await screen.findByRole("menuitem", { name: /Quit FlowAId/ }));
    expect(await screen.findByText("Quit FlowAId?")).toBeTruthy();
    // what quitting would interrupt, as the icon shows it
    expect(
      await screen.findByText(/2 runs are in progress\. 1 approval is waiting; it stays until/),
    ).toBeTruthy();
    expect(api.post).not.toHaveBeenCalled();
    click(screen.getByRole("button", { name: "Quit FlowAId" }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith("/v1/desktop/quit"));
    expect(await screen.findByText("FlowAId has stopped")).toBeTruthy();
    expect(screen.getByText("./flowaid")).toBeTruthy();
  });

  it("offers Quit only to people who administer FlowAId", async () => {
    renderDesktop({ admin: false });
    expect(screen.getByTestId("commands").textContent).toBe("Close window");
    open(await menu());
    await screen.findByRole("menuitem", { name: /Close window/ });
    expect(screen.queryByRole("menuitem", { name: /Quit FlowAId/ })).toBeNull();
    expect(api.get).not.toHaveBeenCalled();
  });
});

describe("trayPlace", () => {
  it("names the menu bar on macOS and the notification area elsewhere", () => {
    expect(trayPlace({ window: "app", tray: true, platform: "macos" })).toBe("the menu bar");
    expect(trayPlace({ window: "app", tray: true, platform: "windows" })).toBe(
      "the notification area",
    );
    expect(trayPlace({ window: "app", tray: false, platform: "macos" })).toBeNull();
    expect(trayPlace(undefined)).toBeNull();
  });
});
