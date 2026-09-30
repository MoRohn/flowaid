import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { installDomStubs } from "@/primitives/testStubs";
import { apiError, bodyOf, callsTo, stubApi, withClient } from "~/knowledge/pageindex/testApi";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
  usePathname: () => "/acme/workflows/new",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("~/session", () => ({
  useSession: () => ({
    ws: "acme",
    workspaceName: "Acme",
    features: { templates: false, ai_builder: false },
    can: () => true,
  }),
}));
vi.mock("~/shell/AppFrame", () => ({
  AppFrame: ({ children }: { children: ReactNode }) => <>{children}</>,
  PageBody: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("~/importer/ExternalImport", () => ({
  useExternalImport: () => ({ dialog: null, analyse: vi.fn(), setOpen: vi.fn() }),
}));

const { default: NewWorkflowPage } = await import("../../app/(app)/[ws]/workflows/new/page");

const KEY = "flowaid:draft:acme:workflow";

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
  push.mockReset();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const button = (name: RegExp | string) => screen.getByRole<HTMLButtonElement>("button", { name });
const baseRoutes = {
  "GET /v1/providers": () => [{ id: "typesafe", configuredOnServer: true }],
  "GET /v1/credentials": () => ({ items: [], next_cursor: null }),
};

async function walkToBlank() {
  // only Blank needs the name, so the first step can be skipped
  expect(button(/Skip: Choose how to start/).disabled).toBe(false);
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Refund triage" } });
  fireEvent.click(button(/Next: Choose how to start/));
  expect(button(/Next: Create it/).disabled).toBe(true);
  fireEvent.click(await screen.findByRole("radio", { name: /Blank/ }));
  fireEvent.click(button(/Next: Blank/));
}

describe("new workflow, step by step", () => {
  it("names it, chooses Blank and creates it only on Create", async () => {
    const fetchMock = stubApi({
      ...baseRoutes,
      "POST /v1/workflows": () => ({ id: "wf-9" }),
    });
    render(withClient(<NewWorkflowPage />));
    await walkToBlank();
    expect(callsTo(fetchMock, "POST /v1/workflows")).toHaveLength(0);
    expect(window.sessionStorage.getItem(KEY)).toContain("Refund triage");
    fireEvent.click(button("Create"));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/acme/workflows/wf-9"));
    expect(bodyOf(callsTo(fetchMock, "POST /v1/workflows")[0]?.[1])).toEqual({
      name: "Refund triage",
    });
    expect(window.sessionStorage.getItem(KEY)).toBeNull();
  });

  it("keeps the draft and says so when creating fails", async () => {
    stubApi({
      ...baseRoutes,
      "POST /v1/workflows": () => apiError(500, "INTERNAL", "database unavailable"),
    });
    render(withClient(<NewWorkflowPage />));
    await walkToBlank();
    fireEvent.click(button("Create"));
    expect(await screen.findByText(/database unavailable/)).toBeTruthy();
    expect(screen.getByText(/Your name and description are kept/)).toBeTruthy();
    expect(push).not.toHaveBeenCalled();
    expect(window.sessionStorage.getItem(KEY)).toContain("Refund triage");
  });
});
