import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { JsonSchema } from "@/types";
import { installDomStubs } from "@/primitives/testStubs";
import { SchemaForm, resolveWidgetName } from "./SchemaForm";
import { hintsOf } from "./schema";
import type { OptionItem } from "./Combobox";
import type { SchemaWidgetProps } from "./widgets";

installDomStubs();
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  let reject: (reason: unknown) => void = () => undefined;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("x-ui hint key", () => {
  it("reads x-ui as UiHints and x-ui-ext for extension widgets", () => {
    expect(hintsOf({ "x-ui": { widget: "textarea", help: "Shown", collapsed: true } })).toEqual({
      widget: "textarea",
      help: "Shown",
      collapsed: true,
    });
    expect(hintsOf({ "x-ui": { order: 2 }, "x-ui-ext": { widget: "radio" } })).toEqual({
      order: 2,
      widget: "radio",
    });
  });

  it("accepts x-flowaid as a deprecated alias with a development warning and maps advanced to collapsed", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(
      hintsOf({ "x-flowaid": { advanced: true, group: "Legacy group", widget: "radio" } }),
    ).toEqual({ collapsed: true, group: "Legacy group", widget: "radio" });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toMatch(/"x-flowaid" is deprecated/);
  });

  it("renders x-ui help as the field hint", () => {
    render(
      <SchemaForm
        schema={{
          type: "object",
          properties: {
            name: { type: "string", title: "Name", "x-ui": { help: "Shown under the field" } },
          },
        }}
      />,
    );
    expect(screen.getByRole("textbox", { name: "Name" })).toHaveAccessibleDescription(
      "Shown under the field",
    );
  });

  it("warns about unknown widgets and falls back to the type widget", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    render(
      <SchemaForm
        schema={{
          type: "object",
          properties: {
            mystery: { type: "string", title: "Mystery", "x-ui-ext": { widget: "does-not-exist" } },
          },
        }}
      />,
    );
    expect(screen.getByRole("textbox", { name: "Mystery" })).toBeInTheDocument();
    expect(
      warn.mock.calls.some((c) =>
        String(c[0]).includes('unknown widget "does-not-exist" for field "mystery"'),
      ),
    ).toBe(true);
  });
});

describe("widget resolution x-ui.widget → format → type", () => {
  it("resolves the format step", () => {
    const root: JsonSchema = {};
    expect(resolveWidgetName({ type: "string", format: "cron" }, {}, undefined, root)).toBe("cron");
    expect(resolveWidgetName({ type: "string", format: "uri" }, {}, undefined, root)).toBe("uri");
    expect(resolveWidgetName({ type: "string", format: "date-time" }, {}, undefined, root)).toBe(
      "date-time",
    );
    expect(resolveWidgetName({ type: "string", format: "multiline" }, {}, undefined, root)).toBe(
      "textarea",
    );
    expect(resolveWidgetName({ type: "string", "x-secret": true }, {}, undefined, root)).toBe(
      "secret",
    );
    expect(
      resolveWidgetName({ type: "string", format: "cron" }, { widget: "text" }, undefined, root),
    ).toBe("text");
    expect(
      resolveWidgetName({ type: "string" }, { optionsProvider: "servers" }, undefined, root),
    ).toBe("combobox");
    expect(
      resolveWidgetName(
        { type: "array", items: { type: "string" } },
        { widget: "list" },
        undefined,
        root,
      ),
    ).toBeNull();
  });

  it("routes format: cron to the cron widget (placeholder until P1-07 registers CronEditor)", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const schema: JsonSchema = {
      type: "object",
      properties: { schedule: { type: "string", title: "Schedule", format: "cron" } },
    };
    const { container, unmount } = render(<SchemaForm schema={schema} onChange={onChange} />);
    expect(container.querySelector('[data-widget="cron"]')).not.toBeNull();
    await user.type(screen.getByRole("textbox", { name: "Schedule" }), "0 9 * * 1-5");
    await waitFor(() =>
      expect(onChange).toHaveBeenLastCalledWith({ schedule: "0 9 * * 1-5" }, true),
    );
    unmount();
    const CronEditor = ({ value }: SchemaWidgetProps) => (
      <output data-testid="cron-editor">{typeof value === "string" ? value : ""}</output>
    );
    render(
      <SchemaForm
        schema={schema}
        defaultValues={{ schedule: "*/5 * * * *" }}
        widgets={{ cron: CronEditor }}
      />,
    );
    expect(screen.getByTestId("cron-editor")).toHaveTextContent("*/5 * * * *");
  });

  it("stores date-time fields as ISO timestamps", async () => {
    const onChange = vi.fn();
    render(
      <SchemaForm
        schema={{
          type: "object",
          properties: { at: { type: "string", title: "At", format: "date-time" } },
        }}
        onChange={onChange}
      />,
    );
    const input = screen.getByLabelText("At");
    expect(input).toHaveAttribute("type", "datetime-local");
    const user = userEvent.setup();
    await user.type(input, "2026-09-23T10:30");
    await waitFor(() =>
      expect(onChange).toHaveBeenLastCalledWith(
        { at: new Date("2026-09-23T10:30").toISOString() },
        true,
      ),
    );
  });

  it("does not render hidden fields but keeps their value", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const schema: JsonSchema = {
      type: "object",
      properties: {
        name: { type: "string", title: "Name" },
        internalId: {
          type: "string",
          title: "Internal id",
          default: "n_1",
          "x-ui": { widget: "hidden" },
        },
      },
    };
    render(<SchemaForm schema={schema} onChange={onChange} />);
    expect(screen.queryByRole("textbox", { name: "Internal id" })).toBeNull();
    await user.type(screen.getByRole("textbox", { name: "Name" }), "x");
    await waitFor(() =>
      expect(onChange).toHaveBeenLastCalledWith({ name: "x", internalId: "n_1" }, true),
    );
  });
});

describe("ajv validation", () => {
  const schema: JsonSchema = {
    type: "object",
    properties: {
      options: {
        type: "object",
        title: "Options",
        additionalProperties: { type: "string" },
        minProperties: 2,
        "x-ui": { widget: "keyvalue" },
      },
      limits: {
        type: "object",
        title: "Limits",
        properties: { maxCostUsd: { type: "number", title: "Max cost" } },
        required: ["maxCostUsd"],
        "x-ui": { collapsed: true },
      },
    },
    required: ["options"],
  };

  it("reports schema keywords the field rules do not cover (minProperties) under the field", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <SchemaForm
        schema={schema}
        defaultValues={{ limits: { maxCostUsd: 1 } }}
        onChange={onChange}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Add row" }));
    await user.type(screen.getByRole("textbox", { name: "Key 1" }), "billing");
    expect(await screen.findByText("Options needs at least 2 entries")).toBeInTheDocument();
    await waitFor(() =>
      expect(onChange).toHaveBeenLastCalledWith(
        expect.objectContaining({ options: { billing: "" } }),
        false,
      ),
    );
    await user.click(screen.getByRole("button", { name: "Add row" }));
    await user.type(screen.getByRole("textbox", { name: "Key 2" }), "technical");
    await waitFor(() => expect(screen.queryByText("Options needs at least 2 entries")).toBeNull());
    await waitFor(() =>
      expect(onChange).toHaveBeenLastCalledWith(
        { options: { billing: "", technical: "" }, limits: { maxCostUsd: 1 } },
        true,
      ),
    );
  });

  it("blocks submit on issues of fields that are not mounted and lists them", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(
      <SchemaForm
        schema={schema}
        defaultValues={{ options: { a: "A", b: "B" } }}
        onSubmit={onSubmit}
      >
        <button type="submit">Save</button>
      </SchemaForm>,
    );
    // The Limits fieldset is collapsed: its required field is not mounted, ajv still sees it.
    expect(screen.queryByRole("spinbutton", { name: "Max cost" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Max cost is required")).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

describe("x-ui.showWhen", () => {
  const schema: JsonSchema = {
    type: "object",
    properties: {
      method: {
        type: "string",
        title: "Method",
        enum: ["GET", "POST", "PUT"],
        default: "GET",
        "x-ui": { widget: "select" },
      },
      body: {
        type: "string",
        title: "Body",
        minLength: 1,
        "x-ui": { showWhen: { path: "/method", oneOf: ["POST", "PUT"] } },
      },
      verbose: { type: "boolean", title: "Verbose", default: false },
      logLevel: {
        type: "string",
        title: "Log level",
        "x-ui": { showWhen: { path: "verbose", truthy: true } },
      },
      exact: {
        type: "string",
        title: "Exact",
        "x-ui": { showWhen: { path: "/method", equals: "PUT" } },
      },
    },
    required: ["method", "body"],
  };

  it("shows and hides fields as the watched values change (oneOf, truthy, equals)", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<SchemaForm schema={schema} onChange={onChange} />);
    expect(screen.queryByRole("textbox", { name: "Body" })).toBeNull();
    expect(screen.queryByRole("textbox", { name: "Log level" })).toBeNull();
    expect(screen.queryByRole("textbox", { name: "Exact" })).toBeNull();

    await user.click(screen.getByRole("switch", { name: "Verbose" }));
    expect(await screen.findByRole("textbox", { name: "Log level" })).toBeInTheDocument();
    // A hidden required field does not make the config invalid.
    await waitFor(() =>
      expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ verbose: true }), true),
    );

    await user.click(screen.getByRole("combobox", { name: "Method" }));
    await user.click(await screen.findByRole("option", { name: "POST" }));
    expect(await screen.findByRole("textbox", { name: "Body" })).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Exact" })).toBeNull();
    await waitFor(() =>
      expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ method: "POST" }), false),
    );

    await user.click(screen.getByRole("combobox", { name: "Method" }));
    await user.click(await screen.findByRole("option", { name: "PUT" }));
    expect(await screen.findByRole("textbox", { name: "Exact" })).toBeInTheDocument();

    await user.click(screen.getByRole("switch", { name: "Verbose" }));
    await waitFor(() => expect(screen.queryByRole("textbox", { name: "Log level" })).toBeNull());
  });
});

describe("x-ui.collapsed", () => {
  it("renders a collapsed object fieldset closed and a collapsed leaf under Advanced", async () => {
    const user = userEvent.setup();
    const schema: JsonSchema = {
      type: "object",
      properties: {
        name: { type: "string", title: "Name" },
        retry: {
          type: "object",
          title: "Retry",
          properties: { maxAttempts: { type: "integer", title: "Max attempts", default: 3 } },
          "x-ui": { collapsed: true },
        },
        limits: {
          type: "object",
          title: "Limits",
          properties: { maxTokens: { type: "integer", title: "Max tokens" } },
        },
        seed: { type: "integer", title: "Seed", "x-ui": { collapsed: true } },
      },
    };
    render(<SchemaForm schema={schema} />);
    expect(screen.getByRole("spinbutton", { name: "Max tokens" })).toBeInTheDocument();
    expect(screen.queryByRole("spinbutton", { name: "Max attempts" })).toBeNull();
    expect(screen.queryByRole("spinbutton", { name: "Seed" })).toBeNull();
    const retry = screen.getByRole("button", { name: /Retry/ });
    expect(retry).toHaveAttribute("aria-expanded", "false");
    await user.click(retry);
    expect(await screen.findByRole("spinbutton", { name: "Max attempts" })).toHaveValue("3");
    await user.click(screen.getByRole("button", { name: /Advanced/ }));
    expect(await screen.findByRole("spinbutton", { name: "Seed" })).toBeInTheDocument();
  });
});

describe("x-ui.optionsProvider", () => {
  const schema: JsonSchema = {
    type: "object",
    properties: {
      serverId: { type: "string", title: "Server", default: "srv_1" },
      tool: { type: "string", title: "Tool", "x-ui": { optionsProvider: "tools" } },
    },
  };
  const OPTIONS: OptionItem[] = [
    { value: "search_issues", label: "search_issues", description: "Search GitHub issues" },
    { value: "create_issue", label: "create_issue", group: "Write" },
  ];

  it("shows loading, then the options, and writes the chosen value", async () => {
    const user = userEvent.setup();
    const pending = deferred<OptionItem[]>();
    const loadOptions = vi.fn(() => pending.promise);
    const onChange = vi.fn();
    render(
      <SchemaForm
        schema={schema}
        nodeType="flowaid.tools.mcp"
        loadOptions={loadOptions}
        onChange={onChange}
      />,
    );
    const tool = screen.getByRole("combobox", { name: "Tool" });
    expect(tool).toHaveAttribute("aria-busy", "true");
    expect(tool).toHaveTextContent("Loading options…");
    expect(loadOptions).toHaveBeenCalledWith(
      "flowaid.tools.mcp",
      "tools",
      { serverId: "srv_1" },
      "",
    );
    await act(async () => {
      pending.resolve(OPTIONS);
      await pending.promise;
    });
    expect(tool).not.toHaveAttribute("aria-busy");
    await user.click(tool);
    const listbox = await screen.findByRole("listbox");
    await user.click(within(listbox).getByRole("option", { name: /search_issues/ }));
    await waitFor(() =>
      expect(onChange).toHaveBeenLastCalledWith({ serverId: "srv_1", tool: "search_issues" }, true),
    );
    expect(screen.getByRole("combobox", { name: "Tool" })).toHaveTextContent("search_issues");
  });

  it("shows the error with a retry, and the refresh button reloads", async () => {
    const user = userEvent.setup();
    const loadOptions =
      vi.fn<
        (
          nodeType: string,
          name: string,
          config: Record<string, unknown>,
          search: string,
        ) => Promise<OptionItem[]>
      >();
    loadOptions
      .mockRejectedValueOnce(new Error("server unreachable"))
      .mockResolvedValueOnce(OPTIONS)
      .mockResolvedValueOnce([...OPTIONS, { value: "close_issue", label: "close_issue" }]);
    render(<SchemaForm schema={schema} nodeType="flowaid.tools.mcp" loadOptions={loadOptions} />);
    expect(
      await screen.findByText("Could not load options: server unreachable"),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(screen.queryByText(/Could not load options/)).toBeNull());
    expect(loadOptions).toHaveBeenCalledTimes(2);
    await user.click(screen.getByRole("button", { name: "Refresh options" }));
    await waitFor(() => expect(loadOptions).toHaveBeenCalledTimes(3));
    await user.click(screen.getByRole("combobox", { name: "Tool" }));
    expect(await screen.findByRole("option", { name: /close_issue/ })).toBeInTheDocument();
  });

  it("falls back to the enum when no loader is configured", async () => {
    const user = userEvent.setup();
    render(
      <SchemaForm
        schema={{
          type: "object",
          properties: {
            region: {
              type: "string",
              title: "Region",
              enum: ["eu", "us"],
              "x-ui": { widget: "combobox" },
            },
          },
        }}
      />,
    );
    await user.click(screen.getByRole("combobox", { name: "Region" }));
    expect(await screen.findByRole("option", { name: /Eu/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Refresh options" })).toBeNull();
  });
});

describe("x-ui.widget: list", () => {
  it("renders a repeatable list honouring x-ui min/max", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const schema: JsonSchema = {
      type: "object",
      properties: {
        stops: {
          type: "array",
          title: "Stops",
          items: { type: "string" },
          default: ["END"],
          "x-ui": { widget: "list", min: 1, max: 2 },
        },
      },
    };
    render(<SchemaForm schema={schema} onChange={onChange} />);
    expect(screen.getByRole("button", { name: "Remove stop 1" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Add stop" }));
    expect(screen.getByRole("button", { name: "Add stop" })).toBeDisabled();
    expect(screen.getByText("2 / 2")).toBeInTheDocument();
    await user.type(screen.getByRole("textbox", { name: "Stop 2" }), "STOP");
    await waitFor(() =>
      expect(onChange).toHaveBeenLastCalledWith({ stops: ["END", "STOP"] }, true),
    );
    await user.click(screen.getByRole("button", { name: "Remove stop 1" }));
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith({ stops: ["STOP"] }, true));
  });
});

describe("discriminated oneOf", () => {
  it("switches sub-forms and validates only the selected member", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const schema: JsonSchema = {
      type: "object",
      properties: {
        auth: {
          title: "Auth",
          oneOf: [
            {
              type: "object",
              title: "None",
              properties: { type: { const: "none" } },
              required: ["type"],
            },
            {
              type: "object",
              title: "Header",
              properties: {
                type: { const: "header" },
                name: { type: "string", title: "Header name", minLength: 1 },
              },
              required: ["type", "name"],
            },
          ],
        },
      },
    };
    render(<SchemaForm schema={schema} onChange={onChange} />);
    expect(screen.getByRole("radiogroup", { name: "Auth" })).toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: "Header" }));
    const header = await screen.findByRole("textbox", { name: "Header name" });
    await waitFor(() =>
      expect(onChange).toHaveBeenLastCalledWith({ auth: { type: "header" } }, false),
    );
    await user.type(header, "X-Key");
    await waitFor(() =>
      expect(onChange).toHaveBeenLastCalledWith({ auth: { type: "header", name: "X-Key" } }, true),
    );
    await user.click(screen.getByRole("radio", { name: "None" }));
    await waitFor(() =>
      expect(onChange).toHaveBeenLastCalledWith({ auth: { type: "none" } }, true),
    );
    expect(screen.queryByRole("textbox", { name: "Header name" })).toBeNull();
  });
});
