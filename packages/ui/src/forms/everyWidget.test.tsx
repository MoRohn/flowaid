import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { UiHintsSchema } from "@flowaid/workflow-core";
import { installDomStubs } from "@/primitives/testStubs";
import type { JsonSchema } from "@/types";
import { SchemaForm } from "./SchemaForm";

installDomStubs();
afterEach(cleanup);

/** A field schema that fits each x-ui widget. */
function fieldFor(widget: string): JsonSchema {
  const ui = { "x-ui": { widget } };
  switch (widget) {
    case "number":
    case "slider":
      return { type: "number", minimum: 0, maximum: 1, ...ui } as JsonSchema;
    case "switch":
      return { type: "boolean", ...ui } as JsonSchema;
    case "select":
    case "combobox":
      return { type: "string", enum: ["a", "b"], ...ui } as JsonSchema;
    case "keyvalue":
      return { type: "object", additionalProperties: { type: "string" }, ...ui } as JsonSchema;
    case "list":
    case "levels":
      return { type: "array", items: { type: "string" }, ...ui } as JsonSchema;
    case "schema":
    case "questions":
    case "criteria":
    case "json":
      return { type: "object", ...ui } as JsonSchema;
    case "cron":
      return { type: "string", format: "cron", ...ui } as JsonSchema;
    default:
      return { type: "string", ...ui } as JsonSchema;
  }
}

describe("every x-ui widget of UiHintsSchema", () => {
  const widgets = UiHintsSchema.shape.widget.unwrap().options.filter((w) => w !== "hidden");

  it.each(widgets)("%s renders its own widget, not a fallback", (widget) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const schema: JsonSchema = { type: "object", properties: { field: fieldFor(widget) } };
    render(<SchemaForm schema={schema} onChange={() => {}} />);
    const messages = warn.mock.calls.map((c) => String(c[0]));
    warn.mockRestore();
    expect(messages.filter((m) => m.includes("unknown widget"))).toEqual([]);
  });
});

describe("the fallback check itself", () => {
  it("does warn for an unregistered widget", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const schema = {
      type: "object",
      properties: { field: { type: "string", "x-ui": { widget: "no-such-widget" } } },
    } as unknown as JsonSchema;
    render(<SchemaForm schema={schema} onChange={() => {}} />);
    const messages = warn.mock.calls.map((c) => String(c[0]));
    warn.mockRestore();
    expect(messages.some((m) => m.includes('unknown widget "no-such-widget"'))).toBe(true);
  });
});
