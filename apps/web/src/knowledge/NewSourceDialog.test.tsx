import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { installDomStubs } from "@/primitives/testStubs";
import { PROCESSING } from "./pageindex/model";
import { bodyOf, callsTo, stubApi, withClient } from "./pageindex/testApi";

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

beforeAll(() => installDomStubs());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  delete features.pageindex;
});

const api = () =>
  stubApi({
    "GET /v1/credentials": () => [
      { id: "cred-oa", name: "OpenAI team key", type: "openai.api_key" },
      { id: "cred-gh", name: "GitHub", type: "http.bearer" },
    ],
    "GET /v1/providers": () => [
      { id: "openai", models: 3, configuredOnServer: false },
      { id: "ollama", models: 0, configuredOnServer: true },
    ],
    "GET /v1/models": () => [
      { provider: "openai", model: "gpt-4.1-mini", kind: "chat" },
      { provider: "openai", model: "text-embedding-3-small", kind: "embedding" },
    ],
    "POST /v1/knowledge/sources": (init) => ({
      id: "src-9",
      name: (bodyOf(init) as { name: string }).name,
    }),
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

    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: "Policies" } });
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
    await waitFor(() => expect(push).toHaveBeenCalledWith("/acme/knowledge/src-9"));
  });

  it("keeps the other kinds unchanged", () => {
    features.pageindex = true;
    api();
    render(withClient(<NewSourceDialog open onOpenChange={() => undefined} />));
    expect(screen.getByText("Search by")).toBeTruthy();
    expect(screen.queryByText(PROCESSING.local)).toBeNull();
  });
});
