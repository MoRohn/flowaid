import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { installDomStubs } from "@/primitives/testStubs";
import { apiError, bodyOf, callsTo, stubApi, withClient } from "~/knowledge/pageindex/testApi";

const scopes = new Set(["mcp:write", "tools:write", "credentials:read", "api_keys:manage"]);
vi.mock("~/session", () => ({
  useSession: () => ({
    ws: "acme",
    workspaceName: "Acme",
    environments: [{ id: "env-dev", name: "dev", protected: false }],
    features: {},
    can: (s: string) => scopes.has(s),
  }),
}));

const { McpServerDialog } = await import("./McpServerDialog");
const { OpenApiTab } = await import("./OpenApiTab");

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
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const button = (name: RegExp | string) => screen.getByRole<HTMLButtonElement>("button", { name });

const server = {
  id: "srv-1",
  name: "files",
  transport: "streamable_http",
  url: "http://localhost:8931/mcp",
  command: null,
  args: null,
  authKind: "none",
  credentialId: null,
  status: "pending",
  toolPolicy: null,
  toolCount: 0,
  warnings: [],
  lastError: null,
  lastCheckedAt: null,
  createdAt: "2026-09-29T00:00:00.000Z",
};

describe("connecting an MCP server", () => {
  it("explains a local address, saves, and calls the server only when asked", async () => {
    const fetchMock = stubApi({
      "GET /v1/credentials": () => ({ items: [], next_cursor: null }),
      "POST /v1/mcp/servers": () => server,
      "POST /v1/mcp/servers/srv-1/test": () => ({ ok: false, message: "connect ECONNREFUSED" }),
    });
    render(
      withClient(
        <McpServerDialog open onOpenChange={() => undefined} onDiscovered={() => undefined} />,
      ),
    );
    expect(button(/Next: Choose how FlowAId signs in/).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: "files" } });
    fireEvent.change(screen.getByLabelText(/^URL/), {
      target: { value: "http://localhost:8931/mcp" },
    });
    expect(screen.getByText(/FLOWAID_ALLOW_PRIVATE_NETWORK=true/)).toBeTruthy();
    const rail = screen.getByRole("navigation", { name: "Steps" });
    fireEvent.click(within(rail).getByRole("button", { name: /Review and save/ }));
    expect(screen.getByText("Every required setting is filled in")).toBeTruthy();

    fireEvent.click(button("Save server"));
    expect(await screen.findByText("files is saved")).toBeTruthy();
    expect(bodyOf(callsTo(fetchMock, "POST /v1/mcp/servers")[0]?.[1])).toEqual({
      name: "files",
      transport: "streamable_http",
      url: "http://localhost:8931/mcp",
      authKind: "none",
      credentialId: null,
    });
    expect(callsTo(fetchMock, "POST /v1/mcp/servers/srv-1/test")).toHaveLength(0);
    expect(window.sessionStorage.getItem("flowaid:draft:acme:mcp-server")).toBeNull();

    fireEvent.click(button("Test connection"));
    expect(await screen.findByText("files did not answer")).toBeTruthy();
    expect(screen.getByText("connect ECONNREFUSED")).toBeTruthy();
    expect(screen.getByText(/the api needs FLOWAID_ALLOW_PRIVATE_NETWORK/)).toBeTruthy();
    expect(callsTo(fetchMock, "POST /v1/mcp/servers/srv-1/discover")).toHaveLength(0);
  });

  it("does not save a stdio server for a non-admin, and keeps the draft", async () => {
    window.localStorage.setItem("flowaid:guided-mode", "all");
    const fetchMock = stubApi({ "GET /v1/credentials": () => ({ items: [], next_cursor: null }) });
    render(
      withClient(
        <McpServerDialog open onOpenChange={() => undefined} onDiscovered={() => undefined} />,
      ),
    );
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: "files" } });
    fireEvent.click(screen.getByRole("radio", { name: /stdio/ }));
    fireEvent.change(screen.getByLabelText(/^Command/), { target: { value: "npx" } });
    expect(
      screen.getAllByText(/Only workspace admins can add stdio servers/).length,
    ).toBeGreaterThan(0);
    fireEvent.click(button("Save server"));
    expect(await screen.findAllByText(/Use the full path of the executable/)).toBeTruthy();
    expect(callsTo(fetchMock, "POST /v1/mcp/servers")).toHaveLength(0);
    const kept = JSON.parse(
      window.sessionStorage.getItem("flowaid:draft:acme:mcp-server") ?? "{}",
    ) as { transport?: string; command?: string };
    expect(kept).toMatchObject({ transport: "stdio", command: "npx" });
  });
});

const preview = {
  title: "Acme Shop",
  version: "2.1",
  servers: ["https://shop.example.com/api"],
  authSchemes: { apiKey: { type: "apiKey" } },
  warnings: [],
  operations: [
    { name: "listOrders", method: "get", path: "/orders", summary: "List orders" },
    { name: "cancelOrder", method: "post", path: "/orders/{id}/cancel", summary: "Cancel" },
  ],
};

async function openImport() {
  const importButton = await screen.findByRole("button", { name: "Import OpenAPI" });
  act(() => {
    fireEvent.click(importButton);
  });
}

describe("importing an OpenAPI document", () => {
  it("reads the document first, then imports only the chosen operations", async () => {
    const fetchMock = stubApi({
      "GET /v1/tools": () => ({ items: [], next_cursor: null }),
      "GET /v1/credentials": () => ({ items: [], next_cursor: null }),
      "POST /v1/tools/openapi/preview": () => preview,
      "POST /v1/tools/openapi/import": () => ({
        id: "t-1",
        name: "acme-shop",
        kind: "openapi",
        definitions: [{ name: "listOrders" }],
        source: {},
        credentialId: null,
        version: 1,
        createdAt: "",
        updatedAt: "",
        skipped: [],
      }),
    });
    render(withClient(<OpenApiTab />));
    await openImport();
    expect(button(/^Import$/).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/^Document URL/), {
      target: { value: "https://shop.example.com/openapi.json" },
    });
    fireEvent.click(button("Read the document"));
    expect(await screen.findByRole("button", { name: "Read it again" })).toBeTruthy();
    expect(screen.getByText(/Acme Shop/).textContent).toContain("2 operations");
    expect(callsTo(fetchMock, "POST /v1/tools/openapi/import")).toHaveLength(0);

    fireEvent.click(button(/Next: Choose the operations/));
    fireEvent.click(screen.getByRole("checkbox", { name: "cancelOrder" }));
    const rail = screen.getByRole("navigation", { name: "Steps" });
    fireEvent.click(within(rail).getByRole("button", { name: /Review and import/ }));
    expect(screen.getByText(/declares apiKey authentication but no credential/)).toBeTruthy();

    fireEvent.click(button("Import 1 operations"));
    await waitFor(() =>
      expect(callsTo(fetchMock, "POST /v1/tools/openapi/import")).toHaveLength(1),
    );
    expect(bodyOf(callsTo(fetchMock, "POST /v1/tools/openapi/import")[0]?.[1])).toEqual({
      url: "https://shop.example.com/openapi.json",
      name: "acme-shop",
      serverUrl: "https://shop.example.com/api",
      include: ["listOrders"],
    });
    expect(await screen.findByText(/acme-shop: 1 operations imported/)).toBeTruthy();
  });

  it("shows why a document could not be read and keeps the address", async () => {
    stubApi({
      "GET /v1/tools": () => ({ items: [], next_cursor: null }),
      "POST /v1/tools/openapi/preview": () =>
        apiError(422, "E_TOOL_SERVER_PRIVATE", "the document URL is a private address"),
    });
    render(withClient(<OpenApiTab />));
    await openImport();
    fireEvent.change(screen.getByLabelText(/^Document URL/), {
      target: { value: "http://localhost:4000/openapi.json" },
    });
    expect(screen.getByText(/reads it only with FLOWAID_ALLOW_PRIVATE_NETWORK/)).toBeTruthy();
    fireEvent.click(button("Read the document"));
    expect(await screen.findAllByText(/the document URL is a private address/)).toBeTruthy();
    expect(button(/^Import$/).disabled).toBe(true);
    expect(window.sessionStorage.getItem("flowaid:draft:acme:openapi")).toContain("localhost:4000");
  });
});

describe("exposing a workflow as an MCP tool", () => {
  it("warns when nothing is deployed, exposes it, then offers a token pinned to it", async () => {
    const { ExposuresSection } = await import("./McpTab");
    const fetchMock = stubApi({
      "GET /v1/mcp/exposures": () => ({ items: [], next_cursor: null }),
      "GET /v1/workflows": () => ({
        items: [{ id: "wf-1", name: "Refund desk", slug: "refund-desk", description: "" }],
        next_cursor: null,
      }),
      "GET /v1/workflows/wf-1": () => ({
        id: "wf-1",
        name: "Refund desk",
        deployments: [],
        draft: { inputs: { type: "object", properties: { order: { type: "string" } } } },
      }),
      "POST /v1/mcp/exposures": () => ({ exposure: { id: "e-1" }, url: "/mcp/acme" }),
    });
    render(withClient(<ExposuresSection />));
    const expose = await screen.findByRole("button", { name: "Expose workflow" });
    await waitFor(() => expect(expose.hasAttribute("disabled")).toBe(false));
    act(() => {
      fireEvent.click(expose);
    });
    act(() => {
      fireEvent.keyDown(screen.getByRole("combobox", { name: /Workflow/ }), { key: "Enter" });
    });
    const item = await screen.findByRole("option", { name: "Refund desk" });
    act(() => {
      fireEvent.keyDown(item, { key: "Enter" });
    });
    expect(await screen.findByText("Nothing is deployed to dev yet")).toBeTruthy();
    fireEvent.click(button(/Next: Name and describe the tool/));
    expect(screen.getByLabelText<HTMLInputElement>(/^Tool name/).value).toBe("refund-desk");
    expect(screen.getByText("order")).toBeTruthy();

    fireEvent.click(button("Expose"));
    await waitFor(() => expect(callsTo(fetchMock, "POST /v1/mcp/exposures")).toHaveLength(1));
    expect(bodyOf(callsTo(fetchMock, "POST /v1/mcp/exposures")[0]?.[1])).toEqual({
      workflowId: "wf-1",
      environmentId: "env-dev",
      toolName: "refund-desk",
      description: "Runs the Refund desk workflow",
    });
    fireEvent.click(await screen.findByRole("button", { name: "Mint a token for it" }));
    expect(await screen.findByRole("heading", { name: "Mint an MCP token" })).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: "Refund desk" }).getAttribute("aria-checked")).toBe(
      "true",
    );
    expect(screen.getByText(/No tool in dev for Refund desk/)).toBeTruthy();
    expect(callsTo(fetchMock, "POST /v1/mcp/tokens")).toHaveLength(0);
  });
});
