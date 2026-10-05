/**
 * FlowExpr fields (roadmap B-09): a manifest field with `x-ui.language: "flowexpr"` (a Transform's
 * expression, an Assert's condition) is an expression editor with the step's references, not a
 * "JavaScript" code box: `boolean_1.` offers `decision`, and a reference the step cannot read is
 * underlined with what to write instead.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type { JsonSchema } from "@/types";
import { installDomStubs } from "@/primitives/testStubs";
import { flowExprCompletions } from "./FlowExprEditor";
import { SchemaForm } from "./SchemaForm";
import { hintsOf } from "./schema";
import { checkExpression } from "./templateCheck";
import type { TemplateRef } from "./TemplateEditor";

installDomStubs();
afterEach(cleanup);

const refs: TemplateRef[] = [
  { ref: { kind: "port", node: "start", port: "message" }, schema: { type: "string" } },
  { ref: { kind: "port", node: "boolean_1", port: "decision" }, schema: { type: "object" } },
];

const transform: JsonSchema = {
  type: "object",
  required: ["expr"],
  properties: {
    expr: { type: "string", title: "Expression", "x-ui": { widget: "code", language: "flowexpr" } },
  },
};

describe("a FlowExpr field", () => {
  it("is drawn by the flowexpr widget, not the JavaScript code box", () => {
    expect(hintsOf({ type: "string", "x-ui": { widget: "code", language: "flowexpr" } })).toEqual({
      widget: "flowexpr",
    });
    // a JavaScript code field stays a code box
    expect(
      hintsOf({ type: "string", "x-ui": { widget: "code", language: "javascript" } }).widget,
    ).toBe("code");

    const { container } = render(
      <SchemaForm schema={transform} defaultValues={{ expr: "start.message" }} />,
    );
    expect(container.querySelector('[data-widget="flowexpr"]')).not.toBeNull();
    expect(container.textContent).not.toMatch(/JavaScript/);
  });

  it("completes a step's outputs after its id, settings after $vars., and nothing in a string", () => {
    const labels = (before: string, inContainer = false) =>
      flowExprCompletions(before, refs, ["limit"], inContainer)?.options.map((o) => o.label) ?? [];
    expect(labels("boolean_1.")).toEqual(["decision"]);
    expect(labels("start.message == 'x' && boolean_1.de")).toEqual(["decision"]);
    expect(labels("$vars.")).toEqual(["limit"]);
    expect(labels("")).toEqual(expect.arrayContaining(["start", "boolean_1", "$vars", "$run"]));
    expect(labels("", true)).toContain("$scope");
    expect(labels("start.message == 'boolean_1.")).toEqual([]);
  });

  it("underlines a reference the step cannot read, and reports a parse error", () => {
    const typo = checkExpression("boolean_1.decison.value > 0.5", refs, [], false);
    expect(typo.error).toBeNull();
    expect(typo.diagnostics).toEqual([
      expect.objectContaining({
        from: 0,
        severity: "warning",
        message: expect.stringContaining("has no output “decison”") as unknown,
      }),
    ]);
    expect(checkExpression("start.message ==", refs, [], false).error).toBeTruthy();
    expect(checkExpression("", refs, [], false)).toEqual({
      references: [],
      diagnostics: [],
      error: null,
    });
    expect(checkExpression("start.message", refs, [], false).references).toEqual(["start.message"]);
  });
});
