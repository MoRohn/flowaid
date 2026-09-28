import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { installDomStubs } from "@/primitives/testStubs";
import { ThemeProvider } from "@flowaid/ui/theme";
import { documentTitle } from "./frame";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  usePathname: () => "/acme/runs",
  useRouter: () => ({ push, replace: vi.fn() }),
}));
const features: Record<string, boolean> = { runs: true, human_tasks: true };
vi.mock("~/session", () => ({
  useSession: () => ({
    ws: "acme",
    workspaceName: "Acme",
    environments: [],
    features,
    local: true,
    can: () => true,
    me: { principal: { role: "owner" }, workspaces: [{ slug: "acme", name: "Acme" }], user: null },
  }),
}));
const tasks = vi.hoisted(() => ({ items: [] as unknown[] }));
const get = vi.hoisted(() => vi.fn());
vi.mock("~/api/client", async (actual) => ({
  ...(await actual<Record<string, unknown>>()),
  get,
}));

const { AppFrame } = await import("./AppFrame");

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k) => map.get(k) ?? null,
    key: (i) => Array.from(map.keys())[i] ?? null,
    removeItem: (k) => void map.delete(k),
    setItem: (k, v) => void map.set(k, v),
  };
}

beforeAll(() => {
  installDomStubs();
  Object.defineProperty(window, "localStorage", { value: memoryStorage(), configurable: true });
  // a desktop-wide shell: the full breadcrumb trail and the nav beside the page, not in a drawer
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    width: 1280,
    height: 800,
  } as DOMRect);
});
beforeEach(() => {
  get.mockImplementation((path: string) =>
    Promise.resolve(
      path.startsWith("/v1/human-tasks")
        ? { items: tasks.items, next_cursor: null }
        : { items: [], next_cursor: null },
    ),
  );
});
afterEach(() => {
  cleanup();
  push.mockReset();
  get.mockReset();
  features.human_tasks = true;
});

const task = (id: string) => ({
  id,
  runId: `run-${id}`,
  nodeRunId: "nr",
  nodeId: "approve_refund",
  scope: "",
  workflowId: "wf",
  status: "open",
});

function frame() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <ThemeProvider defaultSetting="light">
      <QueryClientProvider client={client}>
        <AppFrame
          crumbs={[{ label: "Acme" }, { label: "Runs", href: "/acme/runs" }, { label: "01a0e530" }]}
        >
          <p>page</p>
        </AppFrame>
      </QueryClientProvider>
    </ThemeProvider>,
  );
}

describe("document title", () => {
  it("reads from the page back to the workspace and the product", () => {
    expect(documentTitle([{ label: "Acme" }, { label: "Runs" }], "Acme")).toBe(
      "Runs · Acme · FlowAId",
    );
    expect(documentTitle([{ label: "Workflow" }], "Acme")).toBe("Workflow · Acme · FlowAId");
    expect(
      documentTitle([{ label: "Acme" }, { label: "Evaluations" }, { label: "…" }], "Acme"),
    ).toBe("Evaluations · Acme · FlowAId");
  });

  it("is set while the frame is mounted and restored after", () => {
    document.title = "FlowAId";
    const view = frame();
    expect(document.title).toBe("01a0e530 · Runs · Acme · FlowAId");
    view.unmount();
    expect(document.title).toBe("FlowAId");
  });
});

describe("workspace frame", () => {
  it("renders breadcrumbs as links that route client-side on a plain click", () => {
    frame();
    const trail = within(screen.getByRole("navigation", { name: "Breadcrumb" }));
    const runs = trail.getByRole("link", { name: "Runs" });
    expect(runs.getAttribute("href")).toBe("/acme/runs");
    // the workspace crumb leads to the workspace home
    expect(trail.getByRole("link", { name: "Acme" }).getAttribute("href")).toBe("/acme");
    act(() => {
      runs.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
    });
    expect(push).toHaveBeenCalledWith("/acme/runs");
  });

  it("badges Human tasks with the open task count, read as pending", async () => {
    tasks.items = [task("t1"), task("t2"), task("t3")];
    frame();
    const link = await screen.findByRole("link", { name: "Human tasks 3 pending" });
    expect(link.getAttribute("href")).toBe("/acme/human-tasks");
    expect(get).toHaveBeenCalledWith(
      "/v1/human-tasks?status=open&limit=100",
      expect.objectContaining({ signal: expect.anything() as AbortSignal }),
    );
  });

  it("does not ask for tasks when the human tasks section is off", async () => {
    features.human_tasks = false;
    frame();
    await waitFor(() => expect(screen.getByText("page")).toBeTruthy());
    expect(get).not.toHaveBeenCalledWith(
      expect.stringContaining("/v1/human-tasks"),
      expect.anything(),
    );
  });
});
