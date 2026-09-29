import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { installDomStubs } from "@/primitives/testStubs";
import type { ExpressionScope } from "@/types";
import { BindingField } from "./BindingField";
import { TemplateEditor, TemplateInput, type TemplateRef } from "./TemplateEditor";
import { checkTemplate, templateRefsFromScope } from "./templateCheck";

installDomStubs();
afterEach(cleanup);

const refs: TemplateRef[] = [
  { ref: { kind: "port", node: "start", port: "order_id" }, schema: { type: "string" } },
  { ref: { kind: "port", node: "start", port: "order_total" }, schema: { type: "number" } },
  { ref: { kind: "port", node: "assess", port: "answers" }, schema: { type: "object" } },
];

describe("checkTemplate", () => {
  it("counts the compiler references a template reads, once each", () => {
    const check = checkTemplate(
      "Refund ${{ start.order_total }} for {{ start.order_id }} ({{ upper(start.order_id) }}, {{ $vars.limit }}, {{ assess.answers.reason.value }})",
      refs,
      ["limit"],
      false,
    );
    expect(check.references).toEqual([
      "start.order_total",
      "start.order_id",
      "$vars.limit",
      "assess.answers.reason.value",
    ]);
    expect(check.diagnostics).toEqual([]);
    expect(check.error).toBeNull();
  });

  it("underlines holes that read a missing step, output, setting or $scope", () => {
    const text = "{{ nope.x }} {{ start.missing }} {{ $vars.cap }} {{ $scope.item }} {{ $run.id }}";
    const { diagnostics } = checkTemplate(text, refs, ["limit"], false);
    expect(diagnostics.map((d) => [text.slice(d.from, d.to), d.severity])).toEqual([
      ["{{ nope.x }}", "warning"],
      ["{{ start.missing }}", "warning"],
      ["{{ $vars.cap }}", "warning"],
      ["{{ $scope.item }}", "warning"],
    ]);
    expect(diagnostics[1]?.message).toBe(
      "Step “start” has no output “missing”. It has: order_id, order_total.",
    );
    expect(checkTemplate("{{ $scope.item }}", refs, [], true).diagnostics).toEqual([]);
  });

  it("points the older input. / variables. forms at the ones that compile", () => {
    const { diagnostics } = checkTemplate(
      "{{ input.message }} {{ variables.tone }}",
      refs,
      [],
      false,
    );
    expect(diagnostics.map((d) => d.message)).toEqual([
      "Write start.message to read the run input.",
      "Write $vars.tone to read a setting.",
    ]);
  });

  it("reports a parse error at its offset", () => {
    const check = checkTemplate("Hi {{ start.order_id ", refs, [], false);
    expect(check.error).toMatch(/^Unterminated template hole|^Expected/);
    expect(check.diagnostics[0]?.severity).toBe("error");
  });

  it("derives the references from the builder scope", () => {
    const scope: ExpressionScope = {
      inputs: [],
      variables: [],
      nodes: [
        {
          id: "start",
          name: "Input",
          outputs: [{ id: "message", label: "Message", type: "string" }],
        },
      ],
    };
    expect(templateRefsFromScope(scope)).toEqual([
      { ref: { kind: "port", node: "start", port: "message" }, schema: {} },
    ]);
  });
});

const footer = () => document.querySelector('[data-widget="template"] .font-mono')?.textContent;

describe("template editors", () => {
  it("TemplateEditor counts compiler references instead of saying there are none", async () => {
    render(
      <TemplateEditor
        aria-label="Reply"
        value="We refunded ${{ start.order_total }} for {{ start.order_id }}."
        onChange={() => {}}
        refs={refs}
      />,
    );
    await waitFor(() => expect(footer()).toBe("2 references"));
  });

  it("TemplateEditor shows how many holes need attention", async () => {
    render(
      <TemplateEditor
        aria-label="Reply"
        value="{{ start.nope }}"
        onChange={() => {}}
        refs={refs}
      />,
    );
    await waitFor(() => expect(footer()).toBe("1 reference · 1 issue"));
    expect(document.querySelector(".cm-fa-warning")?.getAttribute("title")).toMatch(/no output/);
  });

  it("TemplateInput reports a parse error under the field", async () => {
    render(<TemplateInput aria-label="Subject" value="Hi {{ " onChange={() => {}} refs={refs} />);
    await waitFor(() => expect(screen.getByText(/template hole/i)).toBeTruthy());
    // no legacy picker: its insertions would not compile
    expect(screen.queryByRole("button", { name: /Insert reference/ })).toBeNull();
  });

  it("BindingField's Template mode uses compiler references, not the legacy picker", async () => {
    const scope: ExpressionScope = {
      inputs: [],
      variables: [{ name: "limit", type: "number" }],
      nodes: [
        {
          id: "start",
          name: "Input",
          outputs: [{ id: "order_id", label: "Order id", type: "string" }],
        },
      ],
    };
    render(
      <BindingField
        label="Reply"
        value={{ kind: "template", source: "Order {{ start.order_id }} over {{ $vars.limit }}" }}
        scope={scope}
        onChange={() => {}}
      />,
    );
    await waitFor(() => expect(footer()).toBe("2 references"));
    expect(screen.queryByRole("button", { name: /Insert reference/ })).toBeNull();
  });
});
