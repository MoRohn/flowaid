import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { installDomStubs } from "@/primitives/testStubs";
import { Toaster } from "@flowaid/ui/primitives";
import type { TemplateRow } from "~/admin/types";
import { templateNeeds } from "./readiness";

const push = vi.fn();
vi.mock("~/session", () => ({
  useSession: () => ({
    ws: "acme",
    workspaceName: "Acme",
    environments: [],
    features: {},
    can: () => true,
    me: { principal: { role: "owner" }, workspaces: [], user: null },
  }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

const { UseTemplateDialog } = await import("./UseTemplateDialog");

const KEY = "flowaid:draft:acme:template:tpl-1";

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
  push.mockClear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function withClient(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={client}>
      {node}
      <Toaster />
    </QueryClientProvider>
  );
}

function stubApi(routes: Record<string, (init?: RequestInit) => unknown>) {
  const fetchMock = vi.fn((input: string, init?: RequestInit) => {
    const path = input.split("?")[0] ?? input;
    const handler = routes[`${init?.method ?? "GET"} ${path}`];
    if (!handler)
      return Promise.resolve(
        Response.json({ error: { code: "NOT_FOUND", message: "not found" } }, { status: 404 }),
      );
    const out = handler(init);
    return Promise.resolve(
      out instanceof Response
        ? out
        : Response.json(out, { status: init?.method === "POST" ? 201 : 200 }),
    );
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const click = (el: HTMLElement) =>
  act(() => {
    fireEvent.click(el);
  });

const template: TemplateRow = {
  id: "tpl-1",
  slug: "issue-triage",
  name: "Issue triage",
  description: "Labels new issues.",
  category: "engineering",
  builtIn: true,
  requiredResources: { mcpServers: [{ key: "github", requiredTools: ["add_labels"] }] },
  requiredSecrets: [{ name: "TYPESAFE_API_KEY", credentialType: "typesafe.api_key" }],
};
const needs = templateNeeds(template, {
  keys: { server: {}, saved: [] },
  mcpServers: 0,
  knowledgeSources: 0,
});

function renderDialog() {
  return render(
    withClient(<UseTemplateDialog template={template} needs={needs} onClose={() => {}} />),
  );
}

describe("Use template", () => {
  it("shows what is missing, then creates a draft copy and opens it", async () => {
    const fetchMock = stubApi({
      "GET /v1/mcp/servers": () => ({ items: [], next_cursor: null }),
      "POST /v1/workflows": () => ({ id: "wf-9", name: "Issue triage" }),
    });
    renderDialog();
    // missing things are warnings with the way to fix them; they never block the copy
    expect(screen.getByText("TypeSafe API key")).toBeTruthy();
    expect(screen.getByText("MCP server (github)")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Connect one under Integrations" })).toBeTruthy();
    click(screen.getByRole("button", { name: /Next: Name your copy/ }));
    click(screen.getByRole("button", { name: /Next: Choose its servers/ }));
    expect(await screen.findByText(/Connect an MCP server under Integrations first/)).toBeTruthy();
    click(screen.getByRole("button", { name: /Skip: Review and create/ }));
    expect(screen.getByText(/Nothing runs, publishes or deploys/)).toBeTruthy();
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
    click(screen.getByRole("button", { name: "Create workflow" }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/acme/workflows/wf-9"));
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === "POST");
    expect(JSON.parse(post?.[1]?.body as string)).toEqual({
      name: "Issue triage",
      templateId: "tpl-1",
    });
  });

  it("keeps the name when creating fails, and across closing the dialog", async () => {
    stubApi({
      "GET /v1/mcp/servers": () => ({ items: [], next_cursor: null }),
      "POST /v1/workflows": () =>
        Response.json({ error: { code: "FORBIDDEN", message: "no write" } }, { status: 403 }),
    });
    renderDialog();
    click(screen.getByRole("button", { name: /Next: Name your copy/ }));
    act(() => {
      fireEvent.change(screen.getByLabelText("Workflow name"), {
        target: { value: "Triage for web" },
      });
    });
    click(screen.getByRole("button", { name: "Create workflow" }));
    expect(await screen.findByText("Could not create the workflow")).toBeTruthy();
    expect(push).not.toHaveBeenCalled();
    expect(screen.getByLabelText<HTMLInputElement>("Workflow name").value).toBe("Triage for web");
    await waitFor(() => expect(window.sessionStorage.getItem(KEY)).toContain("Triage for web"));
    cleanup();
    renderDialog();
    expect(screen.getByText(/Picked up where you left off/)).toBeTruthy();
  });
});
