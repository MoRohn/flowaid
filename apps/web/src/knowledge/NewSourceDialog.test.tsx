import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { installDomStubs } from "@/primitives/testStubs";
import { PROCESSING } from "./pageindex/model";
import { apiError, bodyOf, callsTo, stubApi, withClient } from "./pageindex/testApi";

const features: Record<string, boolean> = {};
const push = vi.fn();
vi.mock("~/session", () => ({
  useSession: () => ({
    ws: "acme",
    workspaceName: "Acme",
    features,
    can: () => true,
    me: { principal: { role: "owner" }, workspaces: [], user: null },
  }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

const { NewSourceDialog } = await import("./NewSourceDialog");

const KEY = "flowaid:draft:acme:knowledge-source";

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
/** Every step's fields at once, as a person who knows the form would choose. */
const allFields = () => window.localStorage.setItem("flowaid:guided-mode", "all");
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  delete features.pageindex;
});

const api = (create?: () => unknown) =>
  stubApi({
    "GET /v1/credentials": () => ({
      items: [
        { id: "cred-oa", name: "OpenAI team key", type: "openai.api_key" },
        { id: "cred-gh", name: "GitHub", type: "http.bearer" },
      ],
      next_cursor: null,
    }),
    "GET /v1/providers": () => [
      { id: "openai", models: 3, configuredOnServer: false },
      { id: "ollama", models: 0, configuredOnServer: true },
    ],
    "GET /v1/models": () => [
      { provider: "openai", model: "gpt-4.1-mini", kind: "chat" },
      { provider: "openai", model: "text-embedding-3-small", kind: "embedding" },
    ],
    "POST /v1/knowledge/sources": (init) =>
      create?.() ?? {
        id: "src-9",
        name: (bodyOf(init) as { name: string }).name,
        kind: (bodyOf(init) as { kind: string }).kind,
      },
  });

/** Opens a Radix select by keyboard and picks an option. */
async function pick(combobox: string, option: RegExp | string) {
  const trigger = screen.getByRole("combobox", { name: combobox });
  act(() => {
    fireEvent.keyDown(trigger, { key: "Enter" });
  });
  const item = await screen.findByRole("option", { name: option });
  act(() => {
    fireEvent.keyDown(item, { key: "Enter" });
  });
}

describe("new knowledge source: PageIndex", () => {
  it("offers PageIndex only as a disabled kind, with the setup guide, when it is not configured", async () => {
    allFields();
    api();
    render(withClient(<NewSourceDialog open onOpenChange={() => undefined} />));
    expect(screen.getByRole("link", { name: /Setup guide/ }).getAttribute("href")).toMatch(
      /docs\/pageindex\/SETUP\.md$/,
    );
    act(() => {
      fireEvent.keyDown(screen.getByRole("combobox", { name: "Documents come from" }), {
        key: "Enter",
      });
    });
    const item = await screen.findByRole("option", { name: /PageIndex documents \(PDF\)/ });
    expect(item.getAttribute("aria-disabled")).toBe("true");
    expect(screen.queryByText(PROCESSING.local)).toBeNull();
  });

  it("shows the settings and the processing disclosure before creating, and posts the config", async () => {
    features.pageindex = true;
    allFields();
    const fetchMock = api();
    render(withClient(<NewSourceDialog open onOpenChange={() => undefined} />));
    expect(screen.queryByRole("link", { name: /Setup guide/ })).toBeNull();
    await pick("Documents come from", /PageIndex documents \(PDF\)/);

    expect(await screen.findByText(PROCESSING.local)).toBeTruthy();
    expect(screen.getByText(PROCESSING.cloud)).toBeTruthy();
    expect(screen.queryByText("Search by")).toBeNull();
    expect((document.getElementById("ks-index-model") as HTMLInputElement).value).toBe(
      "qwen2.5:3b",
    );
    expect(screen.getByRole<HTMLInputElement>("radio", { name: /Flash/ }).checked).toBe(true);
    expect(screen.getByRole("combobox", { name: /Tree optimization/ }).textContent).toMatch(
      /Keep sections/,
    );

    // OpenAI has no server key: the workspace credential of its type is offered
    await pick("Indexing model provider", "OpenAI");
    expect((document.getElementById("ks-index-model") as HTMLInputElement).value).toBe(
      "gpt-4.1-mini",
    );
    expect(await screen.findByText(/not configured on the server/)).toBeTruthy();
    await pick("Credential", "OpenAI team key");
    await waitFor(() => expect(screen.queryByText(/not configured on the server/)).toBeNull());

    fireEvent.change(screen.getByRole("textbox", { name: /^Name/ }), {
      target: { value: "Policies" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create source" }));
    await waitFor(() => expect(callsTo(fetchMock, "POST /v1/knowledge/sources")).toHaveLength(1));
    const body = bodyOf(callsTo(fetchMock, "POST /v1/knowledge/sources")[0]?.[1]);
    expect(body).toEqual({
      name: "Policies",
      kind: "pageindex",
      config: {
        indexModel: { provider: "openai", model: "gpt-4.1-mini" },
        credentialId: "cred-oa",
        mode: "flash",
        optimize: "off",
      },
    });
    // creating ends on what happens next; opening the source is its own button
    expect(await screen.findByText(/Upload PDFs on its page/)).toBeTruthy();
    expect(screen.getByText(/PageIndex: Retrieve evidence/)).toBeTruthy();
    expect(push).not.toHaveBeenCalled();
    expect(screen.getByRole("link", { name: "Open Policies" }).getAttribute("href")).toBe(
      "/acme/knowledge/src-9",
    );
    expect(window.sessionStorage.getItem(KEY)).toBeNull();
  });

  it("keeps the other kinds unchanged", () => {
    features.pageindex = true;
    allFields();
    api();
    render(withClient(<NewSourceDialog open onOpenChange={() => undefined} />));
    expect(screen.getByText("Search by")).toBeTruthy();
    expect(screen.queryByText(PROCESSING.local)).toBeNull();
  });
});

const next = (name: RegExp) => screen.getByRole<HTMLButtonElement>("button", { name });

describe("new knowledge source, step by step", () => {
  it("walks from a name to a created web-page source and says what happens next", async () => {
    const fetchMock = api();
    render(withClient(<NewSourceDialog open onOpenChange={() => undefined} />));
    expect(next(/Next: Where documents come from/).disabled).toBe(true);
    fireEvent.change(screen.getByRole("textbox", { name: /^Name/ }), {
      target: { value: "Docs" },
    });
    fireEvent.click(next(/Next: Where documents come from/));

    await pick("Documents come from", "Web pages");
    expect(next(/Next: Choose how it is searched/).disabled).toBe(true);
    expect(screen.getByRole("status").textContent).toContain("add at least one page URL");
    fireEvent.change(screen.getByRole("textbox", { name: /^Pages/ }), {
      target: { value: "https://docs.example.com/a\nhttps://docs.example.com/b" },
    });
    fireEvent.click(next(/Next: Choose how it is searched/));

    // the workspace credential makes OpenAI's embedding model the default
    await waitFor(() =>
      expect(screen.getByRole("combobox", { name: "Embedding model" }).textContent).toMatch(
        /text-embedding-3-small/,
      ),
    );
    fireEvent.click(next(/Next: Split text into chunks/));
    fireEvent.click(next(/Skip: Review and create/));

    expect(screen.getByText("Web pages · 2 URLs")).toBeTruthy();
    expect(screen.getByText(/Creating it starts the first sync/)).toBeTruthy();
    expect(screen.getByText(/the provider bills those calls/)).toBeTruthy();
    // nothing was created by moving through the steps
    expect(callsTo(fetchMock, "POST /v1/knowledge/sources")).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: "Create source" }));
    await waitFor(() => expect(callsTo(fetchMock, "POST /v1/knowledge/sources")).toHaveLength(1));
    expect(bodyOf(callsTo(fetchMock, "POST /v1/knowledge/sources")[0]?.[1])).toMatchObject({
      name: "Docs",
      kind: "url",
      config: { urls: ["https://docs.example.com/a", "https://docs.example.com/b"] },
      pipeline: {
        chunker: { strategy: "recursive", chunkTokens: 400, overlapTokens: 60 },
        embedding: { provider: "openai", model: "text-embedding-3-small" },
      },
    });
    expect(await screen.findByText(/The first sync has started/)).toBeTruthy();
    expect(screen.getByText(/Knowledge base or Hybrid search/)).toBeTruthy();
  });

  it("keeps the draft when creating fails, and offers it again when reopened", async () => {
    allFields();
    const fetchMock = api(() => apiError(409, "CONFLICT", "a source named Docs exists"));
    const { unmount } = render(withClient(<NewSourceDialog open onOpenChange={() => undefined} />));
    fireEvent.change(screen.getByRole("textbox", { name: /^Name/ }), {
      target: { value: "Docs" },
    });
    fireEvent.change(screen.getByRole("spinbutton", { name: /Overlap tokens/ }), {
      target: { value: "500" },
    });
    fireEvent.blur(screen.getByRole("spinbutton", { name: /Overlap tokens/ }));
    // overlap above the chunk size blocks creating, and the review says why
    await waitFor(() =>
      expect(
        screen.getByRole<HTMLButtonElement>("button", { name: "Create source" }).disabled,
      ).toBe(true),
    );
    expect(screen.getByText("Make the overlap smaller than the chunk size")).toBeTruthy();
    fireEvent.change(screen.getByRole("spinbutton", { name: /Overlap tokens/ }), {
      target: { value: "40" },
    });
    fireEvent.blur(screen.getByRole("spinbutton", { name: /Overlap tokens/ }));
    await waitFor(() =>
      expect(
        screen.getByRole<HTMLButtonElement>("button", { name: "Create source" }).disabled,
      ).toBe(false),
    );
    fireEvent.click(screen.getByRole("button", { name: "Create source" }));
    await waitFor(() => expect(callsTo(fetchMock, "POST /v1/knowledge/sources")).toHaveLength(1));
    expect(await screen.findByText(/a source named Docs exists/)).toBeTruthy();
    expect(screen.getByRole<HTMLInputElement>("textbox", { name: /^Name/ }).value).toBe("Docs");
    expect(JSON.parse(window.sessionStorage.getItem(KEY) ?? "{}")).toMatchObject({
      name: "Docs",
      overlapTokens: 40,
    });
    unmount();
    render(withClient(<NewSourceDialog open onOpenChange={() => undefined} />));
    expect(screen.getByText(/Picked up where you left off/)).toBeTruthy();
    expect(screen.getByRole<HTMLInputElement>("textbox", { name: /^Name/ }).value).toBe("Docs");
  });
});

describe("a source's settings", () => {
  const saved = {
    id: "src-1",
    name: "Audit meaning source",
    kind: "text",
    config: {},
    pipeline: {
      chunker: { strategy: "recursive", chunkTokens: 400, overlapTokens: 60 },
      embedding: { provider: "openai", model: "text-embedding-3-small" },
    },
    credentialId: null,
    status: "error",
    stats: {},
    documents: 3,
    chunks: 0,
    lastSyncAt: null,
    lastError: "No openai.api_key credential is bound for openai",
    createdAt: "",
    updatedAt: "",
  } as const;

  it("changes a saved source, asking before it indexes every document again", async () => {
    allFields();
    const fetchMock = stubApi({
      "GET /v1/credentials": () => ({ items: [], next_cursor: null }),
      "GET /v1/providers": () => [{ id: "openai", models: 3, configuredOnServer: false }],
      "GET /v1/models": () => [
        { provider: "openai", model: "text-embedding-3-small", kind: "embedding" },
      ],
      "PATCH /v1/knowledge/sources/src-1": (init) => ({ ...saved, ...(bodyOf(init) as object) }),
    });
    const onOpenChange = vi.fn();
    render(
      withClient(<NewSourceDialog open onOpenChange={onOpenChange} editing={saved as never} />),
    );
    expect(screen.getByRole("heading", { name: "Settings of Audit meaning source" })).toBeTruthy();
    // nothing changed yet, and the kind stays
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Save" }).disabled).toBe(true);
    expect(
      screen.getByRole<HTMLButtonElement>("combobox", { name: /Documents come from/ }).disabled,
    ).toBe(true);
    // its model has no key, so every document failed: switch it to keywords only
    act(() => {
      fireEvent.click(screen.getByRole("radio", { name: /Keywords only/ }));
    });
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
    });
    expect(screen.getByRole("alert").textContent).toMatch(
      /Saving indexes its 3 documents again with the new settings/,
    );
    expect(callsTo(fetchMock, "PATCH /v1/knowledge/sources/src-1")).toHaveLength(0);
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Save and index again" }));
    });
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(bodyOf(callsTo(fetchMock, "PATCH /v1/knowledge/sources/src-1")[0]?.[1])).toEqual({
      pipeline: {
        chunker: { strategy: "recursive", chunkTokens: 400, overlapTokens: 60 },
        embedding: null,
      },
    });
  });
});
