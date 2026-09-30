import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { SchemaForm } from "@flowaid/ui/forms";
import { installDomStubs } from "@/primitives/testStubs";
import { createLoadOptions, matchOptions, type OptionSources } from "./optionProviders";

beforeAll(() => installDomStubs());
afterEach(cleanup);

const SERVER = "11111111-1111-4111-8111-111111111111";
const TOOLSET = "22222222-2222-4222-8222-222222222222";

function sources(over: Partial<OptionSources> = {}): OptionSources {
  return {
    agents: () =>
      Promise.resolve([
        { id: "a1", name: "Order helper", description: "Looks up orders" },
        { id: "a2", name: "Refund desk", description: "" },
      ]),
    mcpServers: () =>
      Promise.resolve([
        { id: SERVER, name: "GitHub", status: "connected", toolCount: 1 },
        { id: "s2", name: "Broken", status: "error", toolCount: 0 },
      ]),
    mcpTools: (id) =>
      Promise.resolve(id === SERVER ? [{ name: "list_issues", description: "Lists issues" }] : []),
    mcpPrompts: () => Promise.resolve([{ name: "summarize", title: "Summarize a thread" }]),
    toolsets: () =>
      Promise.resolve([
        {
          id: TOOLSET,
          name: "Shop API",
          kind: "openapi",
          definitions: [
            {
              name: "shop_getOrder",
              description: "Get one order",
              source: { kind: "openapi", operationId: "getOrder" },
            },
          ],
        },
        { id: "w1", name: "Workflow tool", kind: "workflow", definitions: [] },
      ]),
    ...over,
  };
}

describe("createLoadOptions", () => {
  const load = createLoadOptions(sources());

  it("lists agent presets by name, keyed by id", async () => {
    expect(await load("flowaid.ai.agent", "agentPresets", {}, "")).toEqual([
      { value: "a1", label: "Order helper", description: "Looks up orders" },
      { value: "a2", label: "Refund desk" },
    ]);
  });

  it("lists MCP servers with their state", async () => {
    const opts = await load("flowaid.tools.mcp", "mcpServers", {}, "");
    expect(opts.map((o) => [o.label, o.description])).toEqual([
      ["GitHub", "1 tool"],
      ["Broken", "error: test it under Integrations"],
    ]);
  });

  it("lists the chosen server's tools and prompts, and asks for the server first", async () => {
    expect(await load("flowaid.tools.mcp", "mcpTools", { serverId: SERVER }, "")).toEqual([
      { value: "list_issues", label: "list_issues", description: "Lists issues" },
    ]);
    expect(await load("flowaid.tools.mcp_prompt", "mcpPrompts", { serverId: SERVER }, "")).toEqual([
      { value: "summarize", label: "Summarize a thread" },
    ]);
    await expect(load("flowaid.tools.mcp", "mcpTools", {}, "")).rejects.toThrow(
      "Choose a server first.",
    );
  });

  it("lists OpenAPI toolsets only, and the chosen toolset's operation ids", async () => {
    expect(await load("flowaid.tools.openapi", "openapiToolsets", {}, "")).toEqual([
      { value: TOOLSET, label: "Shop API", description: "1 operation" },
    ]);
    expect(
      await load("flowaid.tools.openapi", "openapiOperations", { toolsetId: TOOLSET }, ""),
    ).toEqual([{ value: "getOrder", label: "getOrder", description: "Get one order" }]);
    await expect(
      load("flowaid.tools.openapi", "openapiOperations", { toolsetId: "gone" }, ""),
    ).rejects.toThrow("no longer exists");
    await expect(load("flowaid.tools.openapi", "openapiOperations", {}, "")).rejects.toThrow(
      "Choose a toolset first.",
    );
  });

  it("filters by the search and refuses providers it does not know", async () => {
    expect(await load("flowaid.ai.agent", "agentPresets", {}, "REFUND")).toEqual([
      { value: "a2", label: "Refund desk" },
    ]);
    await expect(load("x", "runnables", {}, "")).rejects.toThrow("Edit as JSON");
  });

  it("passes API errors through", async () => {
    const failing = createLoadOptions(
      sources({ agents: () => Promise.reject(new Error("agents are off")) }),
    );
    await expect(failing("flowaid.ai.agent", "agentPresets", {}, "")).rejects.toThrow(
      "agents are off",
    );
  });
});

describe("matchOptions", () => {
  it("matches label, value or description, and keeps everything for an empty search", () => {
    const opts = [
      { value: "v1", label: "Alpha", description: "first" },
      { value: "v2", label: "Beta" },
    ];
    expect(matchOptions(opts, "  ")).toEqual(opts);
    expect(matchOptions(opts, "FIRST")).toEqual([opts[0]]);
    expect(matchOptions(opts, "v2")).toEqual([opts[1]]);
  });
});

describe("agent preset picker", () => {
  const schema = {
    type: "object",
    properties: {
      agentId: {
        type: "string",
        title: "Agent preset",
        "x-ui": { widget: "select", optionsProvider: "agentPresets" },
      },
    },
  };

  it("offers the workspace's presets by name and stores the chosen id", async () => {
    const onChange = vi.fn();
    render(
      <SchemaForm
        schema={schema as never}
        defaultValues={{}}
        nodeType="flowaid.ai.agent"
        loadOptions={createLoadOptions(sources())}
        onChange={onChange}
        aria-label="Agent configuration"
      />,
    );
    const box = await screen.findByRole("combobox");
    await waitFor(() => expect(box.getAttribute("aria-busy")).toBeNull());
    fireEvent.click(box);
    fireEvent.click(await screen.findByText("Order helper"));
    await waitFor(() => expect(onChange.mock.lastCall?.[0]).toMatchObject({ agentId: "a1" }));
  });

  it("shows why the list could not load", async () => {
    render(
      <SchemaForm
        schema={schema as never}
        defaultValues={{}}
        nodeType="flowaid.ai.agent"
        loadOptions={createLoadOptions(
          sources({ agents: () => Promise.reject(new Error("agents are off")) }),
        )}
        onChange={() => {}}
        aria-label="Agent configuration"
      />,
    );
    expect(await screen.findByText(/agents are off/)).toBeTruthy();
  });
});
