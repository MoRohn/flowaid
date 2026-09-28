import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { installDomStubs } from "@/primitives/testStubs";
import type { Me } from "~/api/types";

const replace = vi.fn();
vi.mock("next/navigation", () => ({
  usePathname: () => "/acme",
  useRouter: () => ({ push: vi.fn(), replace }),
}));
const get = vi.hoisted(() => vi.fn());
vi.mock("~/api/client", async (actual) => ({
  ...(await actual<Record<string, unknown>>()),
  get,
}));

const { SessionProvider, meQueryKey, useSession } = await import("./session");
const { default: Root } = await import("../app/page");
const { default: WorkspaceError } = await import("../app/(app)/[ws]/error");

beforeAll(() => installDomStubs());
afterEach(() => {
  cleanup();
  get.mockReset();
  replace.mockReset();
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
    expect(await screen.findByText(/not a member of the workspace “other”/)).toBeTruthy();
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
