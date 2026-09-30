import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { installDomStubs } from "@/primitives/testStubs";
import { Toaster } from "@flowaid/ui/primitives";
import type { CredentialType } from "../types";

const scopes = new Set(["admin", "credentials:read", "credentials:write"]);
vi.mock("~/session", () => ({
  useSession: () => ({
    ws: "acme",
    workspaceName: "Acme",
    environments: [
      { id: "env-dev", name: "dev", protected: false },
      { id: "env-prod", name: "prod", protected: true },
    ],
    features: {},
    can: (s: string) => scopes.has(s),
    me: { principal: { role: "owner" }, workspaces: [], user: null },
  }),
}));

const { CreateCredentialDialog } = await import("./CredentialDialogs");

const KEY = "flowaid:draft:acme:credential";

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

function withClient(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={client}>
      {node}
      <Toaster />
    </QueryClientProvider>
  );
}

/** fetch answering by method and path; unknown paths 404 with the error envelope. */
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

const posts = (f: ReturnType<typeof stubApi>, path: string) =>
  f.mock.calls.filter(([url, init]) => init?.method === "POST" && url.split("?")[0] === path);

const TYPES: CredentialType[] = [
  {
    id: "openai.api_key",
    name: "OpenAI API key",
    description: "Key for OpenAI.",
    fields: [
      { name: "apiKey", secret: true, required: true, schema: { type: "string" } },
      { name: "baseUrl", secret: false, required: false, schema: { type: "string" } },
    ],
    scopes: [],
    testSupported: true,
  },
  {
    id: "http.bearer",
    name: "Bearer token",
    description: "Sent as a bearer token.",
    fields: [{ name: "token", secret: true, required: true, schema: { type: "string" } }],
    scopes: [],
    testSupported: false,
  },
];

const saved = {
  id: "cred-1",
  name: "OpenAI (prod)",
  type: "openai.api_key",
  storage: "db",
  externalRef: null,
  publicFields: {},
  hints: { apiKey: "sk-…6789" },
  scopes: [],
  environmentId: "env-prod",
  allowedWorkflowIds: null,
  lastTestedAt: null,
  lastTestOk: null,
  lastUsedAt: null,
  rotatedAt: null,
  createdAt: "2026-09-29T10:00:00.000Z",
};

function api(create: () => unknown) {
  return stubApi({
    "GET /v1/providers": () => [{ id: "openai", models: 3, configuredOnServer: true }],
    "GET /v1/credentials": () => ({ items: [], next_cursor: null }),
    "GET /v1/workflows": () => ({ items: [{ id: "wf-1", name: "Refunds" }], next_cursor: null }),
    "POST /v1/credentials": create,
    "POST /v1/credentials/cred-1/test": () => Response.json({ ok: true }),
  });
}

const next = (name: RegExp) =>
  act(() => {
    fireEvent.click(screen.getByRole("button", { name }));
  });

function renderDialog() {
  return render(
    withClient(
      <CreateCredentialDialog
        open
        onOpenChange={() => {}}
        types={TYPES}
        environments={
          [
            { id: "env-dev", name: "dev", protected: false, variables: {} },
            { id: "env-prod", name: "prod", protected: true, variables: {} },
          ] as never
        }
      />,
    ),
  );
}

async function fillOpenAi() {
  expect(
    screen.getByRole<HTMLButtonElement>("button", { name: /Next: Enter the secret/ }).disabled,
  ).toBe(true);
  act(() => {
    fireEvent.click(screen.getByRole("radio", { name: /OpenAI API key/ }));
  });
  // the server's own key is explained before a second one is added
  expect(await screen.findByText(/already has its own OpenAI key/)).toBeTruthy();
  next(/Next: Enter the secret/);
  act(() => {
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: "OpenAI (prod)" } });
    fireEvent.change(screen.getByLabelText(/^API key/), {
      target: { value: "sk-live-secret-6789" },
    });
    fireEvent.change(screen.getByLabelText(/^Base URL/), {
      target: { value: "https://llm.example.com/v1" },
    });
  });
}

describe("New credential", () => {
  it("walks from the service to a tested credential, keeping no secret in the tab", async () => {
    const fetchMock = api(() => saved);
    renderDialog();
    await fillOpenAi();
    await waitFor(() => expect(window.sessionStorage.getItem(KEY)).toContain("OpenAI (prod)"));
    expect(window.sessionStorage.getItem(KEY)).toContain("llm.example.com");
    expect(window.sessionStorage.getItem(KEY)).not.toContain("sk-live-secret");

    next(/Next: Choose where it may be used/);
    act(() => {
      fireEvent.click(screen.getByRole("combobox", { name: /Environment/ }));
    });
    act(() => {
      fireEvent.click(screen.getByRole("option", { name: "prod" }));
    });
    next(/Next: Review and create/);
    expect(screen.getByText("Everything the credential needs is filled in")).toBeTruthy();
    expect(screen.getByText(/Only prod can use it/)).toBeTruthy();
    // creating is the only thing that sends anything
    expect(posts(fetchMock, "/v1/credentials")).toHaveLength(0);
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Create credential" }));
    });

    expect(await screen.findByText("OpenAI (prod) is saved")).toBeTruthy();
    expect(await screen.findByText(/Connection test passed/)).toBeTruthy();
    expect(screen.getByText(/Settings → Secrets/)).toBeTruthy();
    const body = JSON.parse(posts(fetchMock, "/v1/credentials")[0]?.[1]?.body as string) as Record<
      string,
      unknown
    >;
    expect(body).toEqual({
      name: "OpenAI (prod)",
      type: "openai.api_key",
      storage: "db",
      values: { apiKey: "sk-live-secret-6789", baseUrl: "https://llm.example.com/v1" },
      environmentId: "env-prod",
    });
    expect(window.sessionStorage.getItem(KEY)).toBeNull();
  });

  it("keeps everything typed when the server refuses the credential", async () => {
    const fetchMock = api(() =>
      Response.json(
        { error: { code: "CONFLICT", message: "a credential named OpenAI (prod) exists" } },
        { status: 409 },
      ),
    );
    renderDialog();
    await fillOpenAi();
    next(/Next: Choose where it may be used/);
    next(/Next: Review and create/);
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Create credential" }));
    });
    expect(await screen.findByText("Could not create the credential")).toBeTruthy();
    expect(posts(fetchMock, "/v1/credentials/cred-1/test")).toHaveLength(0);
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: /Enter the secret/ }));
    });
    expect(screen.getByLabelText<HTMLInputElement>(/^API key/).value).toBe("sk-live-secret-6789");
    expect(screen.getByLabelText<HTMLInputElement>(/^Name/).value).toBe("OpenAI (prod)");
  });

  it("blocks a limited credential with no workflow chosen", async () => {
    api(() => saved);
    renderDialog();
    await fillOpenAi();
    next(/Next: Choose where it may be used/);
    act(() => {
      fireEvent.click(screen.getByRole("radio", { name: "Only the workflows I choose" }));
    });
    expect(screen.getByRole("status").textContent).toContain("choose at least one workflow");
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Create credential" }).disabled,
    ).toBe(true);
    const refunds = await screen.findByRole("checkbox", { name: "Refunds" });
    act(() => {
      fireEvent.click(refunds);
    });
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Create credential" }).disabled,
    ).toBe(false);
  });
});
