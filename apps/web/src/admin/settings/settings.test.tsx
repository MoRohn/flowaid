import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { installDomStubs } from "@/primitives/testStubs";
import { Toaster } from "@flowaid/ui/primitives";
import type { NotificationChannel } from "../types";

const scopes = new Set([
  "admin",
  "api_keys:manage",
  "workflows:read",
  "runs:create",
  "runs:read",
  "evaluations:read",
]);
vi.mock("~/session", () => ({
  useSession: () => ({
    ws: "acme",
    workspaceName: "Acme",
    environments: [
      { id: "env-dev", name: "dev", protected: false, variables: {} },
      { id: "env-prod", name: "prod", protected: true, variables: {} },
    ],
    features: { settings_notifications: true },
    can: (s: string) => scopes.has(s),
    me: { principal: { role: "owner" }, workspaces: [], user: null },
  }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/acme/settings",
  useSearchParams: () => new URLSearchParams("tab=api-keys"),
}));

const { ApiKeysTab } = await import("./ApiKeysTab");
const { NotificationsTab } = await import("./NotificationsTab");

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

const click = (el: HTMLElement) =>
  act(() => {
    fireEvent.click(el);
  });

describe("New API key", () => {
  const api = () =>
    stubApi({
      "GET /v1/api-keys": () => ({ items: [], next_cursor: null }),
      "GET /v1/workflows": () => ({ items: [{ id: "wf-1", name: "Refunds" }], next_cursor: null }),
      "POST /v1/api-keys": () => ({
        id: "k-1",
        prefix: "fa_live_abcd1234",
        key: "fa_live_abcd1234secret",
        expiresAt: "2026-12-28T00:00:00.000Z",
      }),
    });

  it("creates a least-privilege key and shows it once with a working request", async () => {
    const fetchMock = api();
    render(withClient(<ApiKeysTab />));
    click(await screen.findByRole("button", { name: "New API key" }));
    act(() => {
      fireEvent.change(screen.getByRole("textbox", { name: /^Name/ }), {
        target: { value: "website-form" },
      });
    });
    click(screen.getByRole("button", { name: /Next: Choose what it may do/ }));
    // the default is the run-only preset
    expect(screen.getByRole("button", { name: "Run workflows" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    click(screen.getByRole("button", { name: /Next: Choose where it works/ }));
    click(screen.getByRole("button", { name: /Next: Set how long it lasts/ }));
    click(screen.getByRole("button", { name: /Next: Review and create/ }));
    expect(screen.getByText(/every run request must name its environmentId/)).toBeTruthy();
    expect(posts(fetchMock, "/v1/api-keys")).toHaveLength(0);
    click(screen.getByRole("button", { name: "Create key" }));

    expect((await screen.findByTestId("one-time-secret")).textContent).toBe(
      "fa_live_abcd1234secret",
    );
    // a key without an environment must name one in its requests
    expect(screen.getByText(/"environmentId": "env-dev"/)).toBeTruthy();
    const body = JSON.parse(posts(fetchMock, "/v1/api-keys")[0]?.[1]?.body as string) as Record<
      string,
      unknown
    >;
    expect(body).toMatchObject({
      name: "website-form",
      scopes: ["workflows:read", "runs:create", "runs:read"],
      mode: "live",
    });
    expect(body).not.toHaveProperty("environmentId");
    expect(window.sessionStorage.getItem("flowaid:draft:acme:api-key")).toBeNull();
  });

  it("will not create a test key limited to a protected environment", async () => {
    api();
    render(withClient(<ApiKeysTab />));
    click(await screen.findByRole("button", { name: "New API key" }));
    act(() => {
      fireEvent.change(screen.getByRole("textbox", { name: /^Name/ }), {
        target: { value: "smoke" },
      });
    });
    click(screen.getByRole("button", { name: /Choose where it works/ }));
    click(screen.getByRole("radio", { name: "Test" }));
    click(screen.getByRole("combobox", { name: /Environment/ }));
    click(screen.getByRole("option", { name: "prod" }));
    // the step says what is wrong in words, rather than pointing at marks the form does not show
    expect(screen.getByRole("status").textContent).toContain(
      "test keys cannot be limited to prod, a protected environment",
    );
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Create key" }).disabled).toBe(
      true,
    );
    // the draft survives closing the dialog in this tab
    await waitFor(() =>
      expect(window.sessionStorage.getItem("flowaid:draft:acme:api-key")).toContain("smoke"),
    );
  });
});

describe("Add a notification channel", () => {
  const channel: NotificationChannel = {
    id: "nc-2",
    kind: "email",
    name: "On-call",
    config: { to: ["oncall@example.com"] },
    events: ["human_task.created", "run.failed"],
    enabled: true,
    secretSet: false,
    createdAt: "2026-09-29T12:00:00.000Z",
  };

  it("adds the channel and sends a test only when asked", async () => {
    const fetchMock = stubApi({
      "GET /v1/notifications": () => ({ items: [], next_cursor: null }),
      "POST /v1/notifications": () => ({ channel }),
      "POST /v1/notifications/nc-2/test": () => Response.json({ ok: true }),
    });
    render(withClient(<NotificationsTab />));
    click(await screen.findByRole("button", { name: "Add channel" }));
    act(() => {
      fireEvent.change(screen.getByLabelText("Name"), { target: { value: "On-call" } });
      fireEvent.change(screen.getByLabelText("Recipients"), {
        target: { value: "oncall@example.com" },
      });
    });
    click(screen.getByRole("button", { name: /Next: Choose the events/ }));
    click(screen.getByRole("button", { name: /Next: Review and add/ }));
    expect(screen.getByText(/SMTP_URL/)).toBeTruthy();
    const dialogAdd = screen.getAllByRole("button", { name: "Add channel" }).at(-1);
    click(dialogAdd as HTMLElement);

    expect(await screen.findByText("On-call is added")).toBeTruthy();
    expect(posts(fetchMock, "/v1/notifications/nc-2/test")).toHaveLength(0);
    click(screen.getByRole("button", { name: "Send a test" }));
    expect(await screen.findByText("Test sent.")).toBeTruthy();
    expect(posts(fetchMock, "/v1/notifications/nc-2/test")).toHaveLength(1);
  });

  it("keeps the channel's fields when adding it fails, and never keeps a Slack URL", async () => {
    stubApi({
      "GET /v1/notifications": () => ({ items: [], next_cursor: null }),
      "POST /v1/notifications": () =>
        Response.json({ error: { code: "INTERNAL", message: "database down" } }, { status: 500 }),
    });
    render(withClient(<NotificationsTab />));
    click(await screen.findByRole("button", { name: "Add channel" }));
    click(screen.getByRole("radio", { name: "Slack" }));
    act(() => {
      fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Ops" } });
      fireEvent.change(screen.getByLabelText("Slack incoming-webhook URL"), {
        target: { value: "https://hooks.slack.com/services/T0/B0/secret" },
      });
    });
    await waitFor(() =>
      expect(window.sessionStorage.getItem("flowaid:draft:acme:notification-channel")).toContain(
        "Ops",
      ),
    );
    expect(window.sessionStorage.getItem("flowaid:draft:acme:notification-channel")).not.toContain(
      "hooks.slack.com",
    );
    act(() => {
      fireEvent.submit(screen.getByLabelText("Name").closest("form") as HTMLFormElement);
    });
    expect(await screen.findByText("Could not add the channel")).toBeTruthy();
    expect(screen.getByLabelText<HTMLInputElement>("Name").value).toBe("Ops");
    expect(screen.getByLabelText<HTMLInputElement>("Slack incoming-webhook URL").value).toContain(
      "hooks.slack.com",
    );
  });
});
