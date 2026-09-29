import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BindingSchema } from "@flowaid/workflow-core";
import type { JsonSchema } from "@/types";
import { installDomStubs } from "@/primitives/testStubs";
import { BindingField } from "./BindingField";
import { SchemaForm } from "./SchemaForm";
import { isRecord } from "./schema";

installDomStubs();
afterEach(cleanup);

const GATE: JsonSchema = {
  type: "object",
  properties: {
    threshold: {
      type: "number",
      title: "Threshold",
      minimum: 0,
      maximum: 1,
      default: 0.8,
      "x-ui": { widget: "number", bindable: true },
    },
  },
  required: ["threshold"],
};

function lastValues(onChange: ReturnType<typeof vi.fn>): unknown {
  const call = onChange.mock.calls.at(-1);
  return call?.[0];
}

describe("BindingField (x-ui.bindable)", () => {
  it("toggles literal ⇄ ref / template / expr and emits each Binding kind", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<SchemaForm schema={GATE} onChange={onChange} />);
    const source = screen.getByRole("radiogroup", { name: "Threshold source" });
    expect(source).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Value" })).toHaveAttribute("aria-checked", "true");

    // literal: the plain value
    const number = screen.getByRole("spinbutton", { name: "Threshold" });
    await user.clear(number);
    await user.type(number, "0.9");
    await user.tab();
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith({ threshold: 0.9 }, true));

    // ref
    await user.click(screen.getByRole("radio", { name: "Reference" }));
    await user.type(
      screen.getByRole("textbox", { name: "Threshold reference" }),
      "$vars.threshold",
    );
    await waitFor(() =>
      expect(lastValues(onChange)).toEqual({
        threshold: { kind: "ref", ref: { kind: "var", name: "threshold" } },
      }),
    );
    const values = lastValues(onChange);
    expect(isRecord(values) && BindingSchema.safeParse(values.threshold).success).toBe(true);
    expect(onChange.mock.calls.at(-1)?.[1]).toBe(true);

    // template: seeded, emitted as { kind: 'template', source }
    await user.click(screen.getByRole("radio", { name: "Template" }));
    await waitFor(() =>
      expect(lastValues(onChange)).toEqual({ threshold: { kind: "template", source: "" } }),
    );

    // expr: seeded from the literal
    await user.click(screen.getByRole("radio", { name: "Expression" }));
    await waitFor(() =>
      expect(lastValues(onChange)).toEqual({ threshold: { kind: "expr", source: "0.9" } }),
    );
    const expr = screen.getByRole("textbox", { name: "Threshold expression" });
    await user.clear(expr);
    await user.type(expr, "intent.decision.confidence * 0.9");
    await waitFor(() =>
      expect(lastValues(onChange)).toEqual({
        threshold: { kind: "expr", source: "intent.decision.confidence * 0.9" },
      }),
    );
    expect(onChange.mock.calls.at(-1)?.[1]).toBe(true);

    // back to literal restores the last literal
    await user.click(screen.getByRole("radio", { name: "Value" }));
    await waitFor(() => expect(lastValues(onChange)).toEqual({ threshold: 0.9 }));
  });

  it("flags an unparsable expression and an incomplete ref", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<SchemaForm schema={GATE} onChange={onChange} />);
    await user.click(screen.getByRole("radio", { name: "Expression" }));
    const expr = screen.getByRole("textbox", { name: "Threshold expression" });
    await user.clear(expr);
    await user.type(expr, "intent.(");
    await waitFor(() => expect(onChange.mock.calls.at(-1)?.[1]).toBe(false));
    expect(screen.getAllByText(/Threshold: /).length).toBeGreaterThan(0);
    await user.click(screen.getByRole("radio", { name: "Reference" }));
    await user.type(screen.getByRole("textbox", { name: "Threshold reference" }), "Not A Ref");
    await waitFor(() => expect(lastValues(onChange)).toEqual({ threshold: null }));
    expect(onChange.mock.calls.at(-1)?.[1]).toBe(false);
  });

  it("reads a stored binding back into its mode", () => {
    render(
      <SchemaForm
        schema={GATE}
        defaultValues={{
          threshold: {
            kind: "ref",
            ref: { kind: "port", node: "intent", port: "decision", path: "/confidence" },
          },
        }}
      />,
    );
    expect(screen.getByRole("radio", { name: "Reference" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByRole("textbox", { name: "Threshold reference" })).toHaveValue(
      "intent.decision.confidence",
    );
  });

  it("wraps a literal that would read as a binding, and always wraps for the binding widget", async () => {
    const user = userEvent.setup();
    const seen: unknown[] = [];
    function Harness({ alwaysBinding }: { alwaysBinding?: boolean }) {
      const [value, setValue] = useState<unknown>(undefined);
      return (
        <BindingField
          label="Body"
          value={value}
          alwaysBinding={alwaysBinding}
          onChange={(v) => {
            seen.push(v);
            setValue(v);
          }}
          renderLiteral={(literal, change) => (
            <button
              type="button"
              onClick={() =>
                change(literal === undefined ? { kind: "ref", note: "a literal object" } : 7)
              }
            >
              set literal
            </button>
          )}
        />
      );
    }
    const { unmount } = render(<Harness />);
    await user.click(screen.getByRole("button", { name: "set literal" }));
    expect(seen.at(-1)).toEqual({
      kind: "literal",
      value: { kind: "ref", note: "a literal object" },
    });
    await user.click(screen.getByRole("button", { name: "set literal" }));
    expect(seen.at(-1)).toBe(7);
    unmount();
    render(<Harness alwaysBinding />);
    await user.click(screen.getByRole("button", { name: "set literal" }));
    await user.click(screen.getByRole("button", { name: "set literal" }));
    expect(seen.at(-1)).toEqual({ kind: "literal", value: 7 });
  });

  it("opens an object binding in Fields mode instead of an empty literal, and edits a field", async () => {
    const user = userEvent.setup();
    const seen: unknown[] = [];
    const value = {
      kind: "object",
      fields: {
        reason: { kind: "ref", ref: { kind: "port", node: "start", port: "reason" } },
        limit: { kind: "ref", ref: { kind: "var", name: "limit" } },
      },
    };
    function Harness() {
      const [v, setV] = useState<unknown>(value);
      return (
        <BindingField
          label="State"
          value={v}
          structured
          onChange={(next) => {
            seen.push(next);
            setV(next);
          }}
        />
      );
    }
    render(<Harness />);
    const source = within(screen.getByRole("radiogroup", { name: "State source" }));
    expect(source.getByRole("radio", { name: "Fields" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("textbox", { name: "State.reason reference" })).toHaveValue(
      "start.reason",
    );
    expect(screen.getByRole("textbox", { name: "State.limit reference" })).toHaveValue(
      "$vars.limit",
    );

    // retyping a nested ref keeps its mode while it is incomplete, then stores the new ref
    const limit = screen.getByRole("textbox", { name: "State.limit reference" });
    await user.clear(limit);
    expect(screen.getByRole("textbox", { name: "State.limit reference" })).toBeInTheDocument();
    await user.type(limit, "$vars.cap");
    expect(seen.at(-1)).toEqual({
      kind: "object",
      fields: {
        reason: value.fields.reason,
        limit: { kind: "ref", ref: { kind: "var", name: "cap" } },
      },
    });
    expect(BindingSchema.safeParse(seen.at(-1)).success).toBe(true);

    // rename keeps the position; a duplicate name is refused with a message
    const name = screen.getByRole("textbox", { name: "State: name of field reason" });
    await user.clear(name);
    await user.type(name, "limit");
    await user.tab();
    expect(screen.getByRole("alert")).toHaveTextContent('There is already a field called "limit".');
    const again = screen.getByRole("textbox", { name: "State: name of field reason" });
    await user.clear(again);
    await user.type(again, "why{Enter}");
    expect(Object.keys((seen.at(-1) as { fields: object }).fields)).toEqual(["why", "limit"]);

    // add and remove
    await user.click(screen.getByRole("button", { name: "Add field" }));
    expect((seen.at(-1) as { fields: Record<string, unknown> }).fields.field_3).toEqual({
      kind: "literal",
      value: null,
    });
    await user.click(screen.getByRole("button", { name: "Remove field field_3" }));
    expect(Object.keys((seen.at(-1) as { fields: object }).fields)).toEqual(["why", "limit"]);
  });

  it("switching away from Fields and back restores the fields", async () => {
    const user = userEvent.setup();
    const seen: unknown[] = [];
    const value = { kind: "object", fields: { a: { kind: "literal", value: 1 } } };
    function Harness() {
      const [v, setV] = useState<unknown>(value);
      return (
        <BindingField
          label="Body"
          value={v}
          onChange={(next) => {
            seen.push(next);
            setV(next);
          }}
        />
      );
    }
    render(<Harness />);
    // shown even without `structured`, because the stored value is an object binding
    const source = within(screen.getByRole("radiogroup", { name: "Body source" }));
    await user.click(source.getByRole("radio", { name: "Expression" }));
    expect(seen.at(-1)).toBeNull();
    await user.click(source.getByRole("radio", { name: "Fields" }));
    expect(seen.at(-1)).toEqual(value);
  });

  it("shows an array binding as a list of items", () => {
    render(
      <BindingField
        label="Tags"
        value={{
          kind: "array",
          items: [
            { kind: "literal", value: "a" },
            { kind: "template", source: "{{ start.tag }}" },
          ],
        }}
        onChange={() => undefined}
      />,
    );
    expect(screen.getByRole("radio", { name: "List" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText("Item 1")).toBeInTheDocument();
    expect(screen.getByText("Item 2")).toBeInTheDocument();
  });

  it("explains the current mode when asked to", async () => {
    const user = userEvent.setup();
    function Harness() {
      const [v, setV] = useState<unknown>(1);
      return <BindingField label="X" value={v} showModeHint onChange={setV} />;
    }
    render(<Harness />);
    expect(screen.getByText("A fixed value, the same on every run.")).toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: "Reference" }));
    expect(
      screen.getByText(/Uses a value from an earlier step, a setting or the run\./),
    ).toBeInTheDocument();
  });
});
