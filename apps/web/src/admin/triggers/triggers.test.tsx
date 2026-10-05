import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { installDomStubs } from "@/primitives/testStubs";
import { Toaster } from "@flowaid/ui/primitives";
import type { NotificationChannel, Schedule, Webhook } from "../types";

const scopes = new Set(["admin", "webhooks:write", "schedules:write", "runs:create"]);
const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  usePathname: () => "/acme/triggers",
}));
vi.mock("~/session", () => ({
  useSession: () => ({
    ws: "acme",
    workspaceName: "Acme",
    environments: [{ id: "env-dev", name: "dev", protected: false }],
    features: { schedules: true, mcp_exposures: true, settings_notifications: true },
    can: (s: string) => scopes.has(s),
    me: { principal: { role: "owner" }, workspaces: [], user: null },
  }),
}));

const { WebhookList } = await import("./Webhooks");
const { ScheduleList } = await import("./Schedules");
const { NotificationsTab } = await import("../settings/NotificationsTab");

beforeAll(() => installDomStubs());
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

/** fetch answering by path; unknown paths 404 with the error envelope. */
function stubApi(routes: Record<string, (init?: RequestInit) => unknown>) {
  const fetchMock = vi.fn((input: string, init?: RequestInit) => {
    const path = input.split("?")[0] ?? input;
    const key = `${init?.method ?? "GET"} ${path}`;
    const handler = routes[key];
    if (!handler)
      return Promise.resolve(
        Response.json({ error: { code: "NOT_FOUND", message: `no ${key}` } }, { status: 404 }),
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

const hook: Webhook = {
  id: "wh-1",
  workflowId: "wf-1",
  environmentId: "env-dev",
  path: "dev/orders",
  url: "https://api.example.com/hooks/acme/dev/orders",
  signature: "hmac_sha256",
  requireTimestamp: true,
  idempotencyHeader: "X-Delivery-Id",
  secretBound: true,
  responseMode: "async",
  enabled: true,
  lastReceivedAt: null,
  createdAt: "2026-09-27T12:00:00.000Z",
};

const schedule: Schedule = {
  id: "sc-1",
  workflowId: "wf-1",
  environmentId: "env-dev",
  cron: "0 9 * * 1-5",
  timezone: "Europe/Berlin",
  overlap: "skip",
  catchUp: "all",
  maxCatchUp: 5,
  jitterMs: 30_000,
  enabled: true,
  nextRunAt: "2026-09-28T07:00:00.000Z",
  lastRunAt: null,
  lastRunId: null,
  lastError: "the workflow has no deployed version in dev",
};

describe("webhook list", () => {
  it("shows loading, then the empty state", async () => {
    stubApi({ "GET /v1/webhooks": () => ({ items: [], next_cursor: null }) });
    render(withClient(<WebhookList />));
    expect(screen.getByLabelText("Loading")).toBeTruthy();
    expect(await screen.findByText(/No webhook is live/)).toBeTruthy();
  });

  it("shows the API error with a retry", async () => {
    stubApi({
      "GET /v1/webhooks": () =>
        Response.json({ error: { code: "INTERNAL", message: "database down" } }, { status: 500 }),
    });
    render(withClient(<WebhookList />));
    expect(await screen.findByText("database down")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });

  it("lists deliveries with duplicate and rejected states", async () => {
    stubApi({
      "GET /v1/webhooks": () => ({ items: [hook], next_cursor: null }),
      "GET /v1/webhooks/wh-1/deliveries": () => ({
        items: [
          {
            id: "d1",
            webhookId: "wh-1",
            runId: "run-1",
            direction: "inbound",
            externalId: "evt_1",
            status: "accepted",
            attempt: 1,
            httpStatus: 202,
            error: null,
            nextAttemptAt: null,
            createdAt: "2026-09-27T12:00:00.000Z",
          },
          {
            id: "d2",
            webhookId: "wh-1",
            runId: "run-1",
            direction: "inbound",
            externalId: "evt_1",
            status: "duplicate",
            attempt: 1,
            httpStatus: 200,
            error: null,
            nextAttemptAt: null,
            createdAt: "2026-09-27T12:00:01.000Z",
          },
          {
            id: "d3",
            webhookId: "wh-1",
            runId: null,
            direction: "inbound",
            externalId: null,
            status: "rejected",
            attempt: 1,
            httpStatus: 401,
            error: "bad signature",
            nextAttemptAt: null,
            createdAt: "2026-09-27T12:00:02.000Z",
          },
        ],
        next_cursor: null,
      }),
    });
    render(withClient(<WebhookList workflowName={() => "Orders"} />));
    expect(await screen.findByDisplayValue("X-Delivery-Id")).toBeTruthy();
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Deliveries" }));
    });
    expect(await screen.findByText("Duplicate (ignored)")).toBeTruthy();
    expect(screen.getByText("Rejected")).toBeTruthy();
    expect(screen.getByText("bad signature")).toBeTruthy();
  });

  it("asks before rotating a secret in use, but not before generating the first", async () => {
    const fetchMock = stubApi({
      "GET /v1/webhooks": () => ({
        items: [hook, { ...hook, id: "wh-2", path: "dev/new", secretBound: false }],
        next_cursor: null,
      }),
      "POST /v1/webhooks/wh-1/rotate-secret": () => ({ secret: "whsec_new", credentialId: "c" }),
      "POST /v1/webhooks/wh-2/rotate-secret": () => ({ secret: "whsec_first", credentialId: "c" }),
    });
    const rotations = () =>
      fetchMock.mock.calls.filter(([url]) => url.endsWith("/rotate-secret")).map(([url]) => url);
    render(withClient(<WebhookList />));
    const rotateButton = await screen.findByRole("button", { name: "Rotate secret" });
    act(() => {
      fireEvent.click(rotateButton);
    });
    expect(screen.getByText("Rotate the signing secret of /dev/orders?")).toBeTruthy();
    expect(screen.getByText(/current secret stops working/)).toBeTruthy();
    expect(rotations()).toEqual([]);
    act(() => {
      fireEvent.click(screen.getAllByRole("button", { name: "Rotate secret" }).at(-1) as Element);
    });
    expect((await screen.findByTestId("one-time-secret")).textContent).toBe("whsec_new");
    expect(rotations()).toEqual(["/v1/webhooks/wh-1/rotate-secret"]);
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "I have copied it" }));
    });
    // nothing to lose yet: generating the first secret doesn't ask
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Generate secret" }));
    });
    expect((await screen.findByTestId("one-time-secret")).textContent).toBe("whsec_first");
  });

  it("offers the signed-timestamp switch only to HMAC webhooks", async () => {
    stubApi({
      "GET /v1/webhooks": () => ({
        items: [{ ...hook, id: "wh-3", signature: "none", secretBound: false }],
        next_cursor: null,
      }),
    });
    render(withClient(<WebhookList />));
    expect(await screen.findByText("Unsigned")).toBeTruthy();
    expect(screen.queryByRole("switch", { name: /signed timestamp/ })).toBeNull();
    expect(screen.getAllByRole("switch")).toHaveLength(1);
  });

  it("keeps a switch busy until its change is saved", async () => {
    let finish: (r: Response) => void = () => undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn((input: string, init?: RequestInit) =>
        init?.method === "PATCH"
          ? new Promise<Response>((resolve) => (finish = resolve))
          : Promise.resolve(Response.json({ items: [hook], next_cursor: null })),
      ),
    );
    render(withClient(<WebhookList />));
    const [enabled] = await screen.findAllByRole("switch");
    act(() => {
      fireEvent.click(enabled as Element);
    });
    await waitFor(() => expect((enabled as HTMLButtonElement).disabled).toBe(true));
    expect(enabled?.getAttribute("aria-busy")).toBe("true");
    await act(async () => {
      finish(Response.json({ ...hook, enabled: false }));
      await Promise.resolve();
    });
    await waitFor(() => expect((enabled as HTMLButtonElement).disabled).toBe(false));
  });
});

describe("schedule list", () => {
  it("shows the definition's cron read-only, the last error and the policy fields", async () => {
    const fetchMock = stubApi({
      "GET /v1/schedules": () => ({ items: [schedule], next_cursor: null }),
      "PATCH /v1/schedules/sc-1": () => ({ ...schedule, jitterMs: 60_000 }),
    });
    render(withClient(<ScheduleList />));
    const cron = await screen.findByLabelText<HTMLInputElement>("Cron (defined in the workflow)");
    expect(cron.disabled).toBe(true);
    expect(cron.value).toBe("0 9 * * 1-5");
    expect(screen.getByText("the workflow has no deployed version in dev")).toBeTruthy();
    expect(screen.getByLabelText("Maximum missed runs")).toBeTruthy();
    const jitter = screen.getByLabelText<HTMLInputElement>("Jitter in seconds");
    expect(jitter.value).toBe("30");
    act(() => {
      fireEvent.change(jitter, { target: { value: "60" } });
      fireEvent.blur(jitter);
    });
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([url, init]) =>
            url === "/v1/schedules/sc-1" && init?.body === JSON.stringify({ jitterMs: 60_000 }),
        ),
      ).toBe(true),
    );
  });

  it("asks before Run now, naming the environment, then links to the run", async () => {
    push.mockClear();
    const fetchMock = stubApi({
      "GET /v1/schedules": () => ({ items: [schedule], next_cursor: null }),
      "POST /v1/schedules/sc-1/trigger": () => Response.json({ run_id: "run-9" }, { status: 202 }),
    });
    render(withClient(<ScheduleList workflowName={() => "Daily digest"} />));
    const runNow = await screen.findByRole("button", { name: "Run now" });
    act(() => {
      fireEvent.click(runNow);
    });
    expect(screen.getByText("Run Daily digest now in dev?")).toBeTruthy();
    expect(screen.getByText(/paid model steps are charged/)).toBeTruthy();
    expect(screen.getByText(/Overlap is Skip/)).toBeTruthy();
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Run now in dev" }));
    });
    const open = await screen.findByRole("button", { name: "Open run" });
    act(() => {
      fireEvent.click(open);
    });
    expect(push).toHaveBeenCalledWith("/acme/runs/run-9");
  });
});

describe("notification channels", () => {
  const channel: NotificationChannel = {
    id: "nc-1",
    kind: "webhook",
    name: "Ops hook",
    config: { url: "https://hooks.example.com/ops" },
    events: ["run.failed"],
    enabled: true,
    secretSet: true,
    createdAt: "2026-09-27T12:00:00.000Z",
  };

  it("shows the empty state and validates a new channel before sending it", async () => {
    const fetchMock = stubApi({
      "GET /v1/notifications": () => ({ items: [], next_cursor: null }),
      "POST /v1/notifications": () => ({ channel, signingSecret: "nfsec_once" }),
    });
    render(withClient(<NotificationsTab />));
    expect(await screen.findByText("No channels yet")).toBeTruthy();
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Add channel" }));
    });
    act(() => {
      fireEvent.click(screen.getByRole("radio", { name: "Webhook" }));
    });
    const dialogSubmit = () =>
      act(() => {
        fireEvent.submit(screen.getByLabelText("Name").closest("form") as HTMLFormElement);
      });
    dialogSubmit();
    expect(await screen.findByText("Give the channel a name.")).toBeTruthy();
    expect(screen.getByText("Enter the http(s) URL to post to.")).toBeTruthy();
    act(() => {
      fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Ops hook" } });
      fireEvent.change(screen.getByLabelText("URL"), {
        target: { value: "https://hooks.example.com/ops" },
      });
    });
    dialogSubmit();
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([, init]) => init?.method === "POST")).toBe(true),
    );
    const body = JSON.parse(
      fetchMock.mock.calls.find(([, init]) => init?.method === "POST")?.[1]?.body as string,
    ) as Record<string, unknown>;
    expect(body).toMatchObject({
      kind: "webhook",
      name: "Ops hook",
      config: { url: "https://hooks.example.com/ops" },
    });
    expect((await screen.findByTestId("one-time-secret")).textContent).toContain("nfsec_once");
  });

  it("reports a failed test send with the server's reason", async () => {
    stubApi({
      "GET /v1/notifications": () => ({ items: [channel], next_cursor: null }),
      "POST /v1/notifications/nc-1/test": () =>
        Response.json({ ok: false, error: "the endpoint answered HTTP 500" }),
    });
    render(withClient(<NotificationsTab />));
    const send = await screen.findByRole("button", { name: "Send a test to Ops hook" });
    act(() => {
      fireEvent.click(send);
    });
    expect(await screen.findByText("Ops hook did not receive the test")).toBeTruthy();
  });

  it("lists what was sent to a channel, with why a send failed", async () => {
    stubApi({
      "GET /v1/notifications": () => ({ items: [channel], next_cursor: null }),
      "GET /v1/notifications/nc-1/deliveries": () => ({
        items: [
          {
            id: "d-2",
            event: "test",
            status: "failed",
            error: "the endpoint answered HTTP 500",
            createdAt: "2026-10-05T12:00:00.000Z",
            sentAt: null,
          },
          {
            id: "d-1",
            event: "run.failed",
            status: "sent",
            error: null,
            createdAt: "2026-10-05T11:00:00.000Z",
            sentAt: "2026-10-05T11:00:01.000Z",
          },
        ],
      }),
    });
    render(withClient(<NotificationsTab />));
    const open = await screen.findByRole("button", { name: "What was sent to Ops hook" });
    act(() => {
      fireEvent.click(open);
    });
    expect(await screen.findByText("Sent to Ops hook")).toBeTruthy();
    const list = await screen.findByRole("list", { name: "Deliveries" });
    expect(within(list).getByText("Test message")).toBeTruthy();
    expect(within(list).getByText("Failed")).toBeTruthy();
    expect(within(list).getByText("the endpoint answered HTTP 500")).toBeTruthy();
    expect(within(list).getByText("A run failed")).toBeTruthy();
    expect(within(list).getByText("Sent")).toBeTruthy();
  });

  it("asks before rotating a channel's signing secret", async () => {
    const fetchMock = stubApi({
      "GET /v1/notifications": () => ({ items: [channel], next_cursor: null }),
      "POST /v1/notifications/nc-1/rotate-secret": () => ({ signingSecret: "nfsec_new" }),
    });
    render(withClient(<NotificationsTab />));
    const rotateIcon = await screen.findByRole("button", {
      name: "Rotate the signing secret of Ops hook",
    });
    act(() => {
      fireEvent.click(rotateIcon);
    });
    expect(screen.getByText("Rotate the signing secret of Ops hook?")).toBeTruthy();
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Rotate secret" }));
    });
    expect((await screen.findByTestId("one-time-secret")).textContent).toBe("nfsec_new");
  });
});
