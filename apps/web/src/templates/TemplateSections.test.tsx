import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { WorkflowTemplateView } from "@flowaid/ui/builder";
import { installDomStubs } from "@/primitives/testStubs";
import type { TemplateRow } from "~/admin/types";
import { TemplateSections } from "./TemplateSections";

beforeAll(() => installDomStubs());
afterEach(() => cleanup());

const row = (id: string, category: string): TemplateRow => ({
  id,
  slug: id,
  name: id,
  description: "",
  category,
  builtIn: true,
  requiredResources: null,
  requiredSecrets: null,
});
const view = (id: string, name: string): WorkflowTemplateView => ({
  id,
  name,
  description: `${name} template`,
  categories: ["decision"],
  nodes: [],
  edges: [],
});

describe("template search", () => {
  it("covers the business flows too", () => {
    render(
      <TemplateSections
        rows={[row("expense", "finance"), row("triage", "support")]}
        views={[view("expense", "Expense approval"), view("triage", "Message triage")]}
        onUse={() => undefined}
      />,
    );
    expect(screen.getByRole("heading", { name: "Business flows" })).toBeTruthy();
    act(() => {
      fireEvent.change(screen.getByRole("searchbox", { name: "Search templates" }), {
        target: { value: "expense" },
      });
    });
    // it used to say "No templates match" right under the Expense approval card
    expect(screen.queryByText("No templates match")).toBeNull();
    expect(screen.getByRole("heading", { name: "All templates" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Use template Expense approval" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Use template Message triage" })).toBeNull();
  });
});
