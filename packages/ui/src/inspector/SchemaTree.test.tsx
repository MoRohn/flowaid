import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { JsonSchema } from "@/types";
import { SchemaTree, resolveSchemaRef, schemaTypeLabel } from "./SchemaTree";
import { portTypeFamily } from "./PortTypeLabel";

afterEach(cleanup);

const SCHEMA: JsonSchema = {
  type: "object",
  required: ["ticket", "tone"],
  $defs: {
    Message: {
      type: "object",
      required: ["role"],
      properties: {
        role: { type: "string", enum: ["customer", "agent"] },
        content: { type: "string", description: "Body text", maxLength: 4000 },
      },
    },
  },
  properties: {
    ticket: { $ref: "#/$defs/Message", description: "The inbound ticket" },
    tone: { type: "string", enum: ["neutral", "warm"], default: "warm" },
    temperature: { type: "number", minimum: 0, maximum: 2 },
    history: { type: "array", items: { $ref: "#/$defs/Message" } },
    tags: { type: "array", items: { type: "string" } },
    mode: { oneOf: [{ type: "string", title: "Named" }, { type: "integer" }] },
  },
};

describe("schemaTypeLabel / resolveSchemaRef", () => {
  it("labels primitives, arrays, enums and unions", () => {
    expect(schemaTypeLabel({ type: "string" })).toBe("string");
    expect(schemaTypeLabel({ type: "array", items: { type: "string" } })).toBe("string[]");
    expect(schemaTypeLabel({ type: "array" })).toBe("any[]");
    expect(schemaTypeLabel({ enum: [1, 2] })).toBe("enum");
    expect(schemaTypeLabel({ oneOf: [{ type: "string" }, { type: "integer" }] })).toBe("one of 2");
    expect(schemaTypeLabel({ type: ["string", "null"] })).toBe("string | null");
    expect(schemaTypeLabel({ properties: {} })).toBe("object");
    expect(schemaTypeLabel({})).toBe("any");
  });

  it("resolves local $defs references and keeps sibling keywords", () => {
    const ticket = SCHEMA.properties?.ticket;
    if (!ticket) throw new Error("missing");
    const resolved = resolveSchemaRef(ticket, SCHEMA);
    expect(resolved.type).toBe("object");
    expect(resolved.description).toBe("The inbound ticket");
    expect(schemaTypeLabel(ticket, SCHEMA)).toBe("object");
  });
});

describe("SchemaTree", () => {
  it("marks required properties, including inside resolved refs", () => {
    render(<SchemaTree schema={SCHEMA} />);
    const items = screen.getAllByRole("treeitem");
    const required = items
      .filter((i) => i.hasAttribute("data-required"))
      .map((i) => i.textContent ?? "");
    expect(required.some((t) => t.startsWith("ticket"))).toBe(true);
    expect(required.some((t) => t.startsWith("tone"))).toBe(true);
    expect(required.some((t) => t.startsWith("role"))).toBe(true);
    const temperature = items.find((i) => i.textContent?.startsWith("temperature"));
    expect(temperature).not.toHaveAttribute("data-required");
    const markers = screen.getAllByText("required");
    expect(markers.length).toBeGreaterThanOrEqual(3);
    for (const m of markers) expect(m).toHaveClass("sr-only");
  });

  it("renders enum values, descriptions and constraints", () => {
    render(<SchemaTree schema={SCHEMA} />);
    expect(screen.getByText("neutral")).toBeInTheDocument();
    expect(screen.getByText("warm")).toBeInTheDocument();
    expect(screen.getByText("The inbound ticket")).toBeInTheDocument();
    expect(screen.getByText("≥ 0, ≤ 2")).toBeInTheDocument();
    expect(screen.getByText('default "warm"')).toBeInTheDocument();
  });

  it("shows array items, oneOf variants and collapses on demand", async () => {
    const user = userEvent.setup();
    render(<SchemaTree schema={SCHEMA} />);
    expect(screen.getByText("[]")).toBeInTheDocument();
    expect(screen.getByText("Named")).toBeInTheDocument();
    expect(screen.getByText("option 2")).toBeInTheDocument();
    const before = screen.getAllByRole("treeitem").length;
    await user.click(screen.getByRole("button", { name: "Collapse ticket" }));
    expect(screen.getAllByRole("treeitem").length).toBe(before - 2);
    const ticket = screen.getAllByRole("treeitem").find((i) => i.textContent?.startsWith("ticket"));
    expect(ticket).toHaveAttribute("aria-expanded", "false");
    if (ticket)
      expect(within(ticket).getByRole("button", { name: "Expand ticket" })).toBeInTheDocument();
  });
});

describe("portTypeFamily", () => {
  it("maps port types to families", () => {
    expect(portTypeFamily("decision")).toBe("decision");
    expect(portTypeFamily("string")).toBe("string");
    expect(portTypeFamily("integer")).toBe("number");
    expect(portTypeFamily("boolean")).toBe("boolean");
    expect(portTypeFamily("object")).toBe("object");
    expect(portTypeFamily("string[]")).toBe("array");
    expect(portTypeFamily("array<message>")).toBe("array");
    expect(portTypeFamily("message")).toBe("message");
    expect(portTypeFamily("any")).toBe("any");
    expect(portTypeFamily("")).toBe("any");
    expect(portTypeFamily("Ticket")).toBe("object");
  });
});
