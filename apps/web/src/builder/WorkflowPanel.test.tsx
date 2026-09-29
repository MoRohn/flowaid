import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { JsonSchema, WorkflowDefinition } from "@flowaid/workflow-core";
import { installDomStubs } from "@/primitives/testStubs";
import { blankDefinition } from "./model";
import { createBuilderStore } from "./store";
import { WorkflowPanel, parseSetting, settingKind, settingLabel } from "./WorkflowPanel";

beforeAll(() => installDomStubs());
afterEach(cleanup);

const ID = "3e7a1c9b-8d2f-4b6e-9a0c-5f4d3e2b1a09";
const withSettings = (): WorkflowDefinition => {
  const d = blankDefinition(ID, "Expenses");
  d.variables = [
    {
      name: "autoApproveLimit",
      schema: { type: "number", minimum: 0 },
      default: 75,
      source: "definition",
      description: "Claims at or under this amount are approved automatically.",
    },
  ];
  return d;
};

describe("settings", () => {
  it("read as words and parse by type, with a fix for bad values", () => {
    expect(settingLabel("autoApproveLimit")).toBe("Auto approve limit");
    expect(settingLabel("max_items")).toBe("Max items");
    const limit = { schema: { type: "number", minimum: 0 } as JsonSchema };
    expect(settingKind(limit)).toBe("number");
    expect(parseSetting(limit, "120")).toEqual({ ok: true, value: 120 });
    expect(parseSetting(limit, "-1")).toEqual({ ok: false, error: "Use 0 or more." });
    expect(parseSetting(limit, "abc")).toMatchObject({ ok: false });
    expect(parseSetting({ schema: { type: "integer" } }, "2.5")).toEqual({
      ok: false,
      error: "Use a whole number.",
    });
  });
});

describe("WorkflowPanel", () => {
  it("changes a setting's default in the draft, and refuses a bad value", () => {
    const store = createBuilderStore({
      workflowId: ID,
      definition: withSettings(),
      draftRevision: 1,
    });
    const view = () => (
      <WorkflowPanel
        definition={store.getState().definition}
        store={store}
        readOnly={false}
        name="Expenses"
        onRename={() => undefined}
      />
    );
    const { rerender } = render(view());
    const input = screen.getByLabelText("Auto approve limit");
    fireEvent.change(input, { target: { value: "-5" } });
    fireEvent.blur(input);
    expect(screen.getByText("Use 0 or more.")).toBeTruthy();
    expect(store.getState().definition.variables[0]?.default).toBe(75);

    fireEvent.change(input, { target: { value: "500" } });
    fireEvent.blur(input);
    expect(store.getState().definition.variables[0]?.default).toBe(500);
    rerender(view());
    expect(store.getState().history.past.at(-1)?.label).toBe("Change Auto approve limit");
  });

  it("adds a setting the steps can use as $vars.<name>", () => {
    const store = createBuilderStore({
      workflowId: ID,
      definition: blankDefinition(ID, "Blank"),
      draftRevision: 1,
    });
    render(
      <WorkflowPanel
        definition={store.getState().definition}
        store={store}
        readOnly={false}
        name="Blank"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Add a setting" }));
    fireEvent.change(screen.getByLabelText(/^Name/, { selector: "#wf-new-setting" }), {
      target: { value: "maxAmount" },
    });
    fireEvent.change(screen.getByLabelText(/^Value/), { target: { value: "250" } });
    fireEvent.click(screen.getByRole("button", { name: "Add setting" }));
    expect(store.getState().definition.variables).toEqual([
      { name: "maxAmount", schema: { type: "number" }, default: 250, source: "definition" },
    ]);
  });
});
