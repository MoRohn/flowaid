import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Diagnostic, JsonSchema } from "@flowaid/workflow-core";
import { installDomStubs } from "@/primitives/testStubs";
import { CronEditor, checkCron, describeCron } from "./CronEditor";
import { JsonSchemaEditor, parseSchemaText, treeUnsupportedReason } from "./JsonSchemaEditor";
import { LevelsList, validateLevels } from "./LevelsList";
import {
  TemplateEditor,
  rangedDiagnostics,
  templateCompletions,
  type TemplateRef,
} from "./TemplateEditor";

installDomStubs();
afterEach(cleanup);

/** The problem text of a failed check (message or count). */
function problemOf(result: { ok?: boolean; message?: string; count?: string }): string {
  return result.message ?? result.count ?? "";
}

const refs: TemplateRef[] = [
  { ref: { kind: "port", node: "intent", port: "value" }, schema: { type: "string" } },
  { ref: { kind: "port", node: "intent", port: "confidence" }, schema: { type: "number" } },
  { ref: { kind: "port", node: "ticket", port: "out" }, schema: { type: "object" } },
];

describe("TemplateEditor", () => {
  it("completes nodes, $vars, $scope, $run and functions at the start of a hole", () => {
    const labels = templateCompletions("", refs, ["tone"], true)?.options.map((o) => o.label) ?? [];
    expect(labels.slice(0, 5)).toEqual(["intent", "ticket", "$vars", "$scope", "$run"]);
    expect(labels).toContain("concat");
    expect(labels).toContain("len");
    // $scope only inside a container, $vars only when variables exist.
    const outside = templateCompletions("", refs, [], false)?.options.map((o) => o.label) ?? [];
    expect(outside).not.toContain("$scope");
    expect(outside).not.toContain("$vars");
  });

  it("completes the ports of a node, variables and run and scope fields", () => {
    expect(templateCompletions("upper(intent.", refs, [], false)).toMatchObject({
      from: 13,
      options: [
        { label: "value", detail: "string" },
        { label: "confidence", detail: "number" },
      ],
    });
    expect(
      templateCompletions("$vars.to", refs, ["tone", "team"], false)?.options.map((o) => o.label),
    ).toEqual(["tone", "team"]);
    expect(templateCompletions("$scope.", refs, [], true)?.options.map((o) => o.label)).toEqual([
      "item",
      "index",
      "iteration",
      "carry",
    ]);
    expect(templateCompletions("$scope.", refs, [], false)).toBeNull();
    expect(templateCompletions("$run.", refs, [], false)?.options.map((o) => o.label)).toContain(
      "id",
    );
    expect(templateCompletions("nobody.", refs, [], false)).toBeNull();
  });

  it("underlines ranged compiler diagnostics and shows the first error", () => {
    const diagnostics = [
      {
        code: "E_TEMPLATE_UNKNOWN_REF",
        severity: "error",
        message: "Unknown node 'intnt'",
        location: { range: { start: 3, end: 8 } },
      },
      { code: "W_TYPE_UNVERIFIED", severity: "warning", message: "not checked", location: {} },
    ] as unknown as Diagnostic[];
    expect(rangedDiagnostics(diagnostics)).toEqual([
      { from: 3, to: 8, severity: "error", message: "Unknown node 'intnt'" },
    ]);
    render(
      <TemplateEditor
        aria-label="Prompt"
        value="{{ intnt.value }}"
        onChange={() => {}}
        refs={refs}
        diagnostics={diagnostics}
      />,
    );
    expect(screen.getByRole("alert").textContent).toBe("Unknown node 'intnt'");
    expect(
      document.querySelector('[data-widget="template"] .cm-fa-error')?.getAttribute("title"),
    ).toBe("Unknown node 'intnt'");
  });
});

function Levels({ initial, onValue }: { initial: string[]; onValue?: (v: string[]) => void }) {
  const [value, setValue] = useState(initial);
  return (
    <LevelsList
      value={value}
      onChange={(v) => {
        setValue(v);
        onValue?.(v);
      }}
    />
  );
}

describe("LevelsList", () => {
  it("adds, edits and removes levels within 2–10", async () => {
    let last: string[] = [];
    render(<Levels initial={["Low", "High"]} onValue={(v) => (last = v)} />);
    expect(screen.getByRole("button", { name: "Remove level 0" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Add level" }));
    expect(last).toEqual(["Low", "High", ""]);
    await userEvent.type(screen.getByRole("textbox", { name: "Level 2 description" }), "Critical");
    expect(last).toEqual(["Low", "High", "Critical"]);
    await userEvent.click(screen.getByRole("button", { name: "Remove level 1" }));
    expect(last).toEqual(["Low", "Critical"]);
  });

  it("reorders with the keyboard grip", async () => {
    let last: string[] = [];
    render(<Levels initial={["a", "b", "c"]} onValue={(v) => (last = v)} />);
    const grips = screen.getAllByRole("button", { name: /reorder|move|drag/i });
    grips[0]?.focus();
    fireEvent.keyDown(grips[0] as HTMLElement, { key: "End" });
    await waitFor(() => expect(last).toEqual(["b", "c", "a"]));
  });

  it("validates the count and empty descriptions", () => {
    expect(problemOf(validateLevels(["only"]))).toMatch(/between\ 2\ and\ 10/);
    expect(validateLevels(["a", " "]).levels).toEqual({ 1: "Describe this level." });
    expect(validateLevels(Array.from({ length: 11 }, () => "x")).count).toMatch(/11 given/);
  });
});

describe("CronEditor", () => {
  const from = new Date("2026-09-23T08:30:00.000Z");

  it("computes the next runs in the schedule's time zone", () => {
    const check = checkCron("0 9 * * 1-5", "Europe/Berlin", 3, from);
    expect(check.ok && check.next.map((d) => d.toISOString())).toEqual([
      "2026-09-24T07:00:00.000Z",
      "2026-09-25T07:00:00.000Z",
      "2026-09-28T07:00:00.000Z",
    ]);
    expect(problemOf(checkCron("0 9 * *", "UTC"))).toMatch(/five fields/);
    expect(checkCron("61 * * * *", "UTC").ok).toBe(false);
    expect(checkCron("", "UTC").ok).toBe(false);
  });

  it("describes the common shapes", () => {
    expect(describeCron("*/15 * * * *")).toBe("Every 15 minutes");
    expect(describeCron("0 9 * * 1-5")).toBe("Weekdays at 09:00");
    expect(describeCron("30 8 * * 1")).toBe("Every Monday at 08:30");
    expect(describeCron("0 0 1 * *")).toBe("Day 1 of every month at 00:00");
    expect(describeCron("5 * * * *")).toBe("Every hour at minute 5");
    expect(describeCron("* * * * *")).toBe("Every minute");
    expect(describeCron("0 9 1-7 * 1")).toBeNull();
  });

  it("previews runs, applies presets and reports errors", async () => {
    let value = "0 9 * * 1-5";
    const { rerender } = render(
      <CronEditor
        aria-label="Schedule"
        value={value}
        onChange={(v) => (value = v)}
        now={from}
        timezone="UTC"
      />,
    );
    expect(
      screen.getByText(
        (_, el) => el?.tagName === "P" && /^Weekdays at 09:00 · UTC$/.test(el.textContent ?? ""),
      ),
    ).toBeTruthy();
    expect(screen.getByRole("list", { name: "Next runs" }).children).toHaveLength(5);
    await userEvent.click(screen.getByRole("button", { name: "Hourly" }));
    expect(value).toBe("0 * * * *");
    rerender(
      <CronEditor aria-label="Schedule" value="99 * * * *" onChange={() => {}} now={from} />,
    );
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "Schedule" }).getAttribute("aria-invalid")).toBe(
      "true",
    );
  });
});

function SchemaHarness({
  initial,
  onValue,
}: {
  initial: JsonSchema;
  onValue: (v: JsonSchema) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <JsonSchemaEditor
      value={value}
      onChange={(v) => {
        setValue(v);
        onValue(v);
      }}
    />
  );
}

describe("JsonSchemaEditor", () => {
  it("adds, renames, requires, retypes and removes fields", async () => {
    let last: JsonSchema = {};
    render(
      <SchemaHarness
        initial={{
          type: "object",
          properties: { team: { type: "string" }, score: { type: "number" } },
          required: ["team"],
        }}
        onValue={(v) => (last = v)}
      />,
    );
    const name = screen.getByRole("textbox", { name: "Name of team" });
    await userEvent.clear(name);
    await userEvent.type(name, "queue{Enter}");
    expect(Object.keys((last as { properties: object }).properties)).toEqual(["queue", "score"]);
    expect(last.required).toEqual(["queue"]);
    await userEvent.click(screen.getByRole("checkbox", { name: "score is required" }));
    expect(last.required).toEqual(["queue", "score"]);
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Type of score" }), "array");
    expect((last as { properties: Record<string, unknown> }).properties.score).toEqual({
      type: "array",
      items: { type: "string" },
    });
    await userEvent.selectOptions(
      screen.getByRole("combobox", { name: "Item type of score" }),
      "object",
    );
    await userEvent.click(screen.getAllByRole("button", { name: "Add field" })[0] as HTMLElement);
    expect((last as { properties: { score: { items: unknown } } }).properties.score.items).toEqual({
      type: "object",
      properties: { field_1: { type: "string" } },
    });
    await userEvent.click(screen.getByRole("button", { name: "Remove queue" }));
    expect(last.required).toEqual(["score"]);
    expect(Object.keys((last as { properties: object }).properties)).toEqual(["score"]);
  });

  it("refuses a duplicate or invalid name", async () => {
    let last: JsonSchema | null = null;
    render(
      <SchemaHarness
        initial={{ type: "object", properties: { a: { type: "string" }, b: { type: "string" } } }}
        onValue={(v) => (last = v)}
      />,
    );
    const a = screen.getByRole("textbox", { name: "Name of a" });
    await userEvent.clear(a);
    await userEvent.type(a, "b");
    expect(a.getAttribute("aria-invalid")).toBe("true");
    await userEvent.tab();
    expect(last).toBeNull();
  });

  it("edits JSON with validation and commits only valid schemas", async () => {
    expect(problemOf(parseSchemaText("{ nope"))).toMatch(/Not valid JSON/);
    expect(problemOf(parseSchemaText("[1]"))).toMatch(/is an object/);
    expect(problemOf(parseSchemaText('{ "type": "strin" }'))).toMatch(/\/type/);
    expect(parseSchemaText('{ "type": "string" }')).toEqual({
      ok: true,
      schema: { type: "string" },
    });
    render(<SchemaHarness initial={{ type: "object", properties: {} }} onValue={() => {}} />);
    await userEvent.click(screen.getByRole("radio", { name: "JSON" }));
    expect(screen.getByRole("textbox", { name: "Schema JSON" })).toBeTruthy();
  });

  it("opens schemas the tree cannot show in JSON mode, saying why", () => {
    expect(treeUnsupportedReason({ type: "object", properties: { a: { anyOf: [] } } })).toBe(
      '"a" uses "anyOf"',
    );
    expect(treeUnsupportedReason({ type: "array", items: [{ type: "string" }] })).toBe(
      "the schema uses tuple items",
    );
    expect(treeUnsupportedReason({ type: ["string", "null"] })).toMatch(/has type/);
    expect(
      treeUnsupportedReason({
        type: "object",
        properties: { a: { type: "string", description: "x" } },
        required: ["a"],
      }),
    ).toBeNull();
    render(<JsonSchemaEditor value={{ $ref: "#/$defs/x" }} onChange={() => {}} />);
    expect(screen.getByText(/Edited as JSON: the schema uses "\$ref"/)).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Fields" })).toBeDisabled();
  });
});
