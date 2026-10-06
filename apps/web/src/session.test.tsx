import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { installDomStubs } from "@/primitives/testStubs";
import { ApiError } from "~/api/client";
import type { Me } from "~/api/types";

const replace = vi.fn();
const nav = vi.hoisted(() => ({ pathname: "/acme" }));
vi.mock("next/navigation", () => ({
  usePathname: () => nav.pathname,
  useRouter: () => ({ push: vi.fn(), replace }),
}));
const get = vi.hoisted(() => vi.fn());
vi.mock("~/api/client", async (actual) => ({
  ...(await actual<Record<string, unknown>>()),
  get,
}));

const { SessionProvider, meQueryKey, retryDelayMs, useSession } = await import("./session");
const { default: Root } = await import("../app/page");
const { default: WorkspaceError } = await import("../app/(app)/[ws]/error");

beforeAll(() => installDomStubs());
afterEach(() => {
  cleanup();
  get.mockReset();
  replace.mockReset();
  nav.pathname = "/acme";
});

const ME = {
  principal: { type: "user", id: "u1", workspaceSlug: "acme", role: "owner", scopes: ["*"] },
  workspaces: [{ slug: "acme", name: "Acme", role: "owner" }],
  features: {},
  authMode: "local",
  user: null,
} as unknown as Me;

function withClient(node: ReactNode, client = new QueryClient()) {
  return <QueryClientProvider client={client}>{node}</QueryClientProvider>;
}

function Name() {
  const s = useSession();
  return (
    <p>
      {s.workspaceName} · {s.environments.length} environments
    </p>
  );
}

describe("workspace session", () => {
  it("asks for the user and the environments at the same time", async () => {
    let answerMe: (me: Me) => void = () => undefined;
    get.mockImplementation((path: string) =>
      path === "/v1/me"
        ? new Promise<Me>((r) => (answerMe = r))
        : Promise.resolve([{ id: "e1", name: "dev" }]),
    );
    render(
      withClient(
        <SessionProvider ws="acme">
          <Name />
        </SessionProvider>,
      ),
    );
    // both requests are out before /v1/me answers
    expect(get.mock.calls.map((c) => c[0] as string)).toEqual(["/v1/me", "/v1/environments"]);
    answerMe(ME);
    expect(await screen.findByText("Acme · 1 environments")).toBeTruthy();
  });

  it("does not wait on environments for a workspace the user is not in", async () => {
    get.mockImplementation((path: string) =>
      path === "/v1/me" ? Promise.resolve(ME) : new Promise(() => undefined),
    );
    render(
      withClient(
        <SessionProvider ws="other">
          <Name />
        </SessionProvider>,
      ),
    );
    expect(
      await screen.findByRole("heading", { name: "No workspace called “other”" }),
    ).toBeTruthy();
  });

  // F-06 / SH-09: /nope-ws/workflows landed on another workspace's Overview without a word
  it("says a workspace does not exist and offers the same page in the user's own", async () => {
    nav.pathname = "/nope-ws/workflows";
    get.mockImplementation((path: string, o?: { headers?: Record<string, string> }) =>
      path !== "/v1/me"
        ? new Promise(() => undefined)
        : o?.headers?.["x-workspace"] === ""
          ? Promise.resolve(ME)
          : Promise.reject(new ApiError(403, "FORBIDDEN", "not a member of workspace 'nope-ws'")),
    );
    render(
      withClient(
        <SessionProvider ws="nope-ws">
          <Name />
        </SessionProvider>,
      ),
    );
    expect(
      await screen.findByRole("heading", { level: 1, name: "No workspace called “nope-ws”" }),
    ).toBeTruthy();
    expect(screen.getByRole("link", { name: /Acme/ }).getAttribute("href")).toBe("/acme/workflows");
    expect(replace).not.toHaveBeenCalled();
  });

  // F-06 / SH-07: with the API down a full load showed "Failed to fetch" and nothing to do
  it("says FlowAId is not answering, how to start it, and comes back once it answers", async () => {
    let up = false;
    get.mockImplementation((path: string) =>
      up
        ? Promise.resolve(path === "/v1/me" ? ME : [{ id: "e1", name: "dev" }])
        : Promise.reject(new TypeError("Failed to fetch")),
    );
    render(
      withClient(
        <SessionProvider ws="acme">
          <Name />
        </SessionProvider>,
        new QueryClient({ defaultOptions: { queries: { retry: false } } }),
      ),
    );
    expect(
      await screen.findByRole("heading", { level: 1, name: "FlowAId is not answering" }),
    ).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toMatch(/Could not reach FlowAId's API/);
    expect(screen.getByText("./flowaid")).toBeTruthy();
    up = true;
    // no click: it tries again on its own after retryDelayMs(1), environments included
    expect(await screen.findByText("Acme · 1 environments", {}, { timeout: 5000 })).toBeTruthy();
  }, 10_000);

  it("spaces its automatic tries out to every 30 seconds", () => {
    expect([1, 2, 3, 4, 5, 9].map(retryDelayMs)).toEqual([2000, 4000, 8000, 16000, 30000, 30000]);
  });

  it("seeds the workspace session with the answer the root page already has", async () => {
    get.mockResolvedValue(ME);
    const client = new QueryClient();
    render(withClient(<Root />, client));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/acme"));
    expect(client.getQueryData(meQueryKey("acme"))).toEqual(ME);
    expect(get).toHaveBeenCalledTimes(1);
  });
});

describe("workspace error boundary", () => {
  it("shows the error with a retry", () => {
    const retry = vi.fn();
    render(<WorkspaceError error={new Error("Boom in the page")} retry={retry} />);
    expect(screen.getByRole("alert").textContent).toContain("Boom in the page");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalledTimes(1);
  });
});
