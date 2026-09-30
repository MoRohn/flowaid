import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { installDomStubs } from "@/primitives/testStubs";
import { apiError, bodyOf, callsTo, stubApi, withClient } from "~/knowledge/pageindex/testApi";

vi.mock("~/session", () => ({
  useSession: () => ({ ws: "acme", workspaceName: "Acme", features: {}, can: () => true }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const { AgentDialog } = await import("./AgentDialog");

const KEY = "flowaid:draft:acme:agent";

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

const api = (create: () => unknown) =>
  stubApi({
    "GET /v1/models": () => [
      { provider: "openai", model: "gpt-test", kind: "chat" },
      { provider: "anthropic", model: "claude-test", kind: "chat" },
    ],
    "GET /v1/providers": () => [
      { id: "openai", models: 1, configuredOnServer: true },
      { id: "anthropic", models: 1, configuredOnServer: false },
    ],
    "GET /v1/credentials": () => ({ items: [], next_cursor: null }),
    "GET /v1/tools/catalog": () => [
      {
        name: "refund",
        description: "Refund an order",
        inputSchema: {},
        idempotency: "none",
        approvalRequired: false,
        source: { kind: "openapi" },
      },
    ],
    "POST /v1/agents": create,
  });

/** A draft left in this tab earlier, so the dialog opens on it. */
const keep = (draft: Record<string, unknown>) =>
  window.sessionStorage.setItem(KEY, JSON.stringify(draft));

const open = () =>
  render(withClient(<AgentDialog open editing={null} onOpenChange={() => undefined} />));

describe("new agent, step by step", () => {
  it("will not move past the name until there is one", () => {
    api(() => ({}));
    open();
    const next = screen.getByRole<HTMLButtonElement>("button", { name: /Next: Choose a model/ });
    expect(next.disabled).toBe(true);
    fireEvent.change(screen.getByRole("textbox", { name: /^Name/ }), {
      target: { value: "Order helper" },
    });
    expect(next.disabled).toBe(false);
    // what was typed is kept in this tab, not sent anywhere
    expect(JSON.parse(window.sessionStorage.getItem(KEY) ?? "{}")).toMatchObject({
      name: "Order helper",
    });
  });

  it("reviews a kept draft, warns about what will fail or act unasked, then creates it", async () => {
    const fetch = api(() => ({ id: "a1", name: "Order helper", description: "", config: {} }));
    keep({
      name: "Order helper",
      model: { provider: "anthropic", model: "claude-test" },
      tools: [{ name: "refund", approval: "never" }],
    });
    open();
    expect(screen.getByText(/Picked up where you left off/)).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: /Review and create/ }));
    await waitFor(() => expect(screen.getByText(/No key for anthropic/)).toBeDefined());
    await waitFor(() =>
      expect(screen.getByText(/refund can change data and will run without asking/)).toBeDefined(),
    );
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Create agent" }));
    });
    await waitFor(() => expect(screen.getByText("Order helper is ready to use")).toBeDefined());
    expect(bodyOf(callsTo(fetch, "POST /v1/agents")[0]?.[1])).toMatchObject({
      name: "Order helper",
      config: { tools: [{ name: "refund", approval: "never" }] },
    });
    expect(window.sessionStorage.getItem(KEY)).toBeNull();
  });

  it("keeps the draft when saving fails", async () => {
    api(() => apiError(500, "INTERNAL", "database unavailable"));
    keep({ name: "Order helper", model: { provider: "openai", model: "gpt-test" } });
    open();
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Create agent" }));
    });
    await waitFor(() => expect(screen.getByText("Could not save the agent")).toBeDefined());
    expect(screen.queryByText(/is ready to use/)).toBeNull();
    expect(JSON.parse(window.sessionStorage.getItem(KEY) ?? "{}")).toMatchObject({
      name: "Order helper",
    });
  });
});

describe("editing an agent", () => {
  const preset = {
    id: "a1",
    name: "Order helper",
    description: "",
    config: { model: { provider: "openai", model: "gpt-test" }, system: "Help." },
    createdAt: "2026-09-30T00:00:00Z",
    updatedAt: "2026-09-30T00:00:00Z",
  };

  it("asks before closing with unsaved changes, and closes at once without any", () => {
    api(() => preset);
    const onOpenChange = vi.fn();
    render(withClient(<AgentDialog open editing={preset} onOpenChange={onOpenChange} />));
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
    onOpenChange.mockClear();

    act(() => {
      fireEvent.click(screen.getByRole("radio", { name: /All fields/ }));
    });
    const description = screen.getByLabelText(/Description/);
    act(() => {
      fireEvent.change(description, { target: { value: "Answers order questions" } });
    });
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    });
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toMatch(/Discard your changes to Order helper/);
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    });
    expect(screen.getByDisplayValue("Answers order questions")).toBeDefined();
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    });
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
