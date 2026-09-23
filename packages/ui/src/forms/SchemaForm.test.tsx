import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { JsonSchema } from "@/types";
import { installDomStubs } from "@/primitives/testStubs";
import { SchemaForm } from "./SchemaForm";
import { registerWidget, type SchemaWidgetProps } from "./widgets";

installDomStubs();
afterEach(cleanup);

const basic: JsonSchema = {
  type: "object",
  properties: {
    name: { type: "string", title: "Node name", minLength: 3 },
    timeoutMs: { type: "integer", title: "Timeout", minimum: 100, maximum: 60000, default: 5000 },
    enabled: { type: "boolean", title: "Enabled", default: true },
    method: { type: "string", title: "Method", enum: ["GET", "POST", "PUT"], default: "GET" },
    tags: { type: "array", title: "Tags", items: { type: "string" }, maxItems: 3 },
  },
  required: ["name"],
};

describe("SchemaForm", () => {
  it("renders a control per type and seeds defaults", () => {
    const { container } = render(<SchemaForm schema={basic} />);
    expect(screen.getByRole("textbox", { name: "Node name" })).toHaveValue("");
    expect(screen.getByRole("spinbutton", { name: "Timeout" })).toHaveValue("5000");
    expect(screen.getByRole("switch", { name: "Enabled" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("combobox", { name: "Method" })).toBeInTheDocument();
    expect(container.querySelector("select")).toHaveValue("GET");
    expect(screen.getByRole("button", { name: "Add tag" })).toBeInTheDocument();
  });

  it("validates required and minLength and reports validity through onChange", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<SchemaForm schema={basic} onChange={onChange} />);
    const name = screen.getByRole("textbox", { name: "Node name" });
    await user.type(name, "ab");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Node name must be at least 3 characters",
    );
    await waitFor(() =>
      expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ name: "ab" }), false),
    );
    await user.type(name, "c");
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    await waitFor(() =>
      expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ name: "abc" }), true),
    );
  });

  it("validates numeric maximum on submit and blocks onSubmit", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(
      <SchemaForm
        schema={basic}
        defaultValues={{ name: "Intent", timeoutMs: 70000 }}
        onSubmit={onSubmit}
      >
        <button type="submit">Save</button>
      </SchemaForm>,
    );
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Timeout must be at most 60000");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("adds and removes array items and honours maxItems", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<SchemaForm schema={basic} defaultValues={{ name: "Intent" }} onChange={onChange} />);
    const add = screen.getByRole("button", { name: "Add tag" });
    await user.click(add);
    await user.click(add);
    const items = screen.getAllByRole("textbox", { name: /^Tag \d$/ });
    expect(items).toHaveLength(2);
    await user.type(items[0] as HTMLElement, "billing");
    await waitFor(() =>
      expect(onChange).toHaveBeenLastCalledWith(
        expect.objectContaining({ tags: ["billing", ""] }),
        expect.any(Boolean),
      ),
    );
    await user.click(screen.getByRole("button", { name: "Remove tag 2" }));
    await waitFor(() =>
      expect(onChange).toHaveBeenLastCalledWith(
        expect.objectContaining({ tags: ["billing"] }),
        expect.any(Boolean),
      ),
    );
    await user.click(add);
    await user.click(add);
    expect(screen.getByText("3 / 3")).toBeInTheDocument();
    expect(add).toBeDisabled();
  });

  it("switches discriminated oneOf variants through a segmented control", async () => {
    const user = userEvent.setup();
    const schema: JsonSchema = {
      type: "object",
      properties: {
        auth: {
          title: "Authentication",
          oneOf: [
            {
              type: "object",
              title: "Bearer token",
              properties: { type: { const: "bearer" }, token: { type: "string", title: "Token" } },
            },
            {
              type: "object",
              title: "Basic",
              properties: {
                type: { const: "basic" },
                username: { type: "string", title: "Username" },
                password: { type: "string", title: "Password" },
              },
            },
          ],
        },
      },
    };
    const onChange = vi.fn();
    render(<SchemaForm schema={schema} onChange={onChange} />);
    expect(screen.getByRole("textbox", { name: "Token" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Bearer token" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await user.click(screen.getByRole("radio", { name: "Basic" }));
    expect(await screen.findByRole("textbox", { name: "Username" })).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Token" })).toBeNull();
    expect(screen.getByRole("radio", { name: "Basic" })).toHaveAttribute("aria-checked", "true");
    await waitFor(() =>
      expect(onChange).toHaveBeenLastCalledWith({ auth: { type: "basic" } }, true),
    );
  });

  it("renders nested objects, groups and the Advanced disclosure", async () => {
    const user = userEvent.setup();
    const schema: JsonSchema = {
      type: "object",
      properties: {
        question: { type: "string", title: "Question", "x-ui": { group: "Decision" } },
        timeoutMs: { type: "integer", title: "Timeout", "x-ui": { collapsed: true } },
        limits: {
          type: "object",
          title: "Limits",
          properties: { maxCostUsd: { type: "number", title: "Max cost" } },
        },
      },
    };
    render(<SchemaForm schema={schema} />);
    expect(screen.getByRole("heading", { name: "Decision" })).toBeInTheDocument();
    expect(screen.getByRole("spinbutton", { name: "Max cost" })).toBeInTheDocument();
    expect(screen.queryByRole("spinbutton", { name: "Timeout" })).toBeNull();
    await user.click(screen.getByRole("button", { name: /Advanced/ }));
    expect(await screen.findByRole("spinbutton", { name: "Timeout" })).toBeInTheDocument();
  });

  it("renders a free-form map as a key/value editor", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const schema: JsonSchema = {
      type: "object",
      properties: {
        headers: { type: "object", title: "Headers", additionalProperties: { type: "string" } },
      },
    };
    render(<SchemaForm schema={schema} onChange={onChange} />);
    await user.click(screen.getByRole("button", { name: "Add row" }));
    await user.type(screen.getByRole("textbox", { name: "Key 1" }), "Accept");
    await user.type(screen.getByRole("textbox", { name: "Value 1" }), "application/json");
    await waitFor(() =>
      expect(onChange).toHaveBeenLastCalledWith({ headers: { Accept: "application/json" } }, true),
    );
  });

  it("uses registered and per-form widgets", () => {
    const Stars = ({ value, onChange }: SchemaWidgetProps) => (
      <button type="button" data-testid="stars" onClick={() => onChange(5)}>
        {typeof value === "number" ? value : 0} stars
      </button>
    );
    registerWidget("stars", Stars);
    const custom: JsonSchema = {
      type: "object",
      properties: {
        rating: { type: "integer", title: "Rating", "x-ui-ext": { widget: "stars" }, default: 2 },
      },
    };
    const first = render(<SchemaForm schema={custom} />);
    expect(screen.getByTestId("stars")).toHaveTextContent("2 stars");
    first.unmount();
    const schema: JsonSchema = {
      type: "object",
      properties: {
        rating: { type: "integer", title: "Rating", "x-ui": { widget: "number" }, default: 3 },
      },
    };
    const { rerender } = render(<SchemaForm schema={schema} />);
    expect(screen.getByRole("spinbutton", { name: "Rating" })).toBeInTheDocument();
    rerender(<SchemaForm schema={schema} widgets={{ number: Stars }} />);
    expect(screen.getByTestId("stars")).toHaveTextContent("3 stars");
  });

  it("resets when the controlled values prop changes and submits valid values", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    function Harness() {
      const [values, setValues] = useState<Record<string, unknown>>({ name: "Intent choice" });
      return (
        <>
          <button type="button" onClick={() => setValues({ name: "Urgency score" })}>
            Load
          </button>
          <SchemaForm schema={basic} values={values} onSubmit={onSubmit}>
            <button type="submit">Save</button>
          </SchemaForm>
        </>
      );
    }
    render(<Harness />);
    expect(screen.getByRole("textbox", { name: "Node name" })).toHaveValue("Intent choice");
    await user.click(screen.getByRole("button", { name: "Load" }));
    await waitFor(() =>
      expect(screen.getByRole("textbox", { name: "Node name" })).toHaveValue("Urgency score"),
    );
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ name: "Urgency score", timeoutMs: 5000, enabled: true }),
      ),
    );
  });

  it("renders radio groups for small enums with the x-ui-ext radio extension", () => {
    const schema: JsonSchema = {
      type: "object",
      properties: {
        backoff: {
          type: "string",
          title: "Backoff",
          enum: ["fixed", "exponential"],
          default: "fixed",
          "x-ui-ext": { widget: "radio" },
        },
      },
    };
    render(<SchemaForm schema={schema} />);
    const group = screen.getByRole("radiogroup", { name: "Backoff" });
    expect(within(group).getAllByRole("radio")).toHaveLength(2);
    expect(within(group).getByRole("radio", { name: "Fixed" })).toBeChecked();
  });
});
