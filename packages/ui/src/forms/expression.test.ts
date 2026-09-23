import { describe, expect, it } from "vitest";
import type { ExpressionScope } from "@/types";
import {
  findExpressionRegions,
  parseExpressionReferences,
  referenceTemplate,
  scopeCompletions,
  scopePaths,
  validateExpression,
} from "./expression";

const scope: ExpressionScope = {
  inputs: [
    { id: "message", label: "Message", type: "string" },
    { id: "customer", label: "Customer", type: "object" },
  ],
  variables: [{ name: "locale", type: "string" }],
  nodes: [
    {
      id: "intent",
      name: "Intent choice",
      outputs: [
        { id: "value", label: "Value", type: "string" },
        { id: "confidence", label: "Confidence", type: "number" },
      ],
    },
    {
      id: "urgency",
      name: "Urgency score",
      outputs: [{ id: "value", label: "Value", type: "number" }],
    },
  ],
};

describe("findExpressionRegions", () => {
  it("finds closed regions with inner offsets", () => {
    const text = "Hi {{ input.message }} and {{nodes.intent.output.value}}";
    const regions = findExpressionRegions(text);
    expect(regions).toHaveLength(2);
    expect(regions[0]).toMatchObject({ from: 3, to: 22, innerFrom: 5, innerTo: 20, closed: true });
    expect(regions[1]?.source).toBe("nodes.intent.output.value");
  });

  it("marks an unclosed trailing region", () => {
    const regions = findExpressionRegions("{{ input.message");
    expect(regions).toHaveLength(1);
    expect(regions[0]?.closed).toBe(false);
    expect(regions[0]?.to).toBe(16);
  });
});

describe("parseExpressionReferences", () => {
  it("extracts dotted references with roots and segments", () => {
    const refs = parseExpressionReferences(
      "{{ nodes.intent.output.confidence >= 0.9 && input.message }}",
    );
    expect(refs.map((r) => r.path)).toEqual(["nodes.intent.output.confidence", "input.message"]);
    expect(refs[0]).toMatchObject({
      root: "nodes",
      segments: ["intent", "output", "confidence"],
      region: 0,
    });
    expect(refs[0]?.from).toBe(3);
    expect(refs[0]?.to).toBe(3 + "nodes.intent.output.confidence".length);
  });

  it("ignores identifiers inside string literals and property accesses", () => {
    const refs = parseExpressionReferences('{{ "nodes.x" + foo.input.bar + variables.locale }}');
    expect(refs.map((r) => r.path)).toEqual(["variables.locale"]);
  });

  it("folds bracket access into segments", () => {
    const refs = parseExpressionReferences(
      '{{ input["ticket id"] }} {{ nodes.intent.output.items[0] }}',
    );
    expect(refs[0]?.segments).toEqual(["ticket id"]);
    expect(refs[1]?.segments).toEqual(["intent", "output", "items", "0"]);
    expect(refs[1]?.region).toBe(1);
  });

  it("keeps an empty trailing segment while typing", () => {
    const refs = parseExpressionReferences("{{ nodes. }}");
    expect(refs[0]?.segments).toEqual([""]);
  });

  it("returns nothing outside braces", () => {
    expect(parseExpressionReferences("input.message nodes.intent")).toEqual([]);
  });
});

describe("validateExpression", () => {
  it("accepts valid references", () => {
    const result = validateExpression(
      "Reply in {{ variables.locale }}: {{ nodes.intent.output.confidence }}",
      scope,
    );
    expect(result.valid).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.references).toHaveLength(2);
  });

  it("flags unbalanced braces", () => {
    const result = validateExpression("{{ input.message", scope);
    expect(result.valid).toBe(false);
    expect(result.issues[0]).toMatchObject({ code: "unbalanced", from: 0 });
    const stray = validateExpression("text }} more", scope);
    expect(stray.issues[0]?.code).toBe("unbalanced");
  });

  it("flags empty expressions", () => {
    expect(validateExpression("{{   }}", scope).issues[0]?.code).toBe("empty");
  });

  it("reports unknown inputs, variables, nodes and outputs with suggestions", () => {
    const unknownInput = validateExpression("{{ input.mesage }}", scope).issues[0];
    expect(unknownInput?.code).toBe("unknown-input");
    expect(unknownInput?.message).toContain('Unknown input "mesage"');
    expect(validateExpression("{{ variables.region }}", scope).issues[0]?.code).toBe(
      "unknown-variable",
    );
    const unknownNode = validateExpression("{{ nodes.intents.output.value }}", scope).issues[0];
    expect(unknownNode?.code).toBe("unknown-node");
    expect(unknownNode?.message).toContain('did you mean "intent"');
    expect(validateExpression("{{ nodes.intent.output.probability }}", scope).issues[0]?.code).toBe(
      "unknown-output",
    );
    expect(validateExpression("{{ nodes.intent.result }}", scope).issues[0]?.code).toBe(
      "unknown-node-member",
    );
  });

  it("allows deeper paths under a known port and node members", () => {
    expect(
      validateExpression("{{ input.customer.tier }} {{ nodes.intent.status }}", scope).valid,
    ).toBe(true);
  });

  it("treats an incomplete path as a warning, not an error", () => {
    const result = validateExpression("{{ nodes. }}", scope);
    expect(result.valid).toBe(true);
    expect(result.issues[0]).toMatchObject({ code: "incomplete", severity: "warning" });
  });

  it("orders issues by position", () => {
    const result = validateExpression("{{ variables.x }} {{ input.y }}", scope);
    expect(result.issues.map((i) => i.code)).toEqual(["unknown-variable", "unknown-input"]);
  });
});

describe("scopeCompletions", () => {
  it("lists roots, then ports, then nodes, members and outputs", () => {
    expect(scopeCompletions([], scope).map((c) => c.label)).toEqual([
      "input",
      "nodes",
      "variables",
    ]);
    expect(scopeCompletions(["input"], scope).map((c) => c.label)).toEqual(["message", "customer"]);
    expect(scopeCompletions(["variables"], scope).map((c) => c.label)).toEqual(["locale"]);
    expect(scopeCompletions(["nodes"], scope).map((c) => c.label)).toEqual(["intent", "urgency"]);
    expect(scopeCompletions(["nodes", "intent"], scope).map((c) => c.label)).toEqual([
      "output",
      "status",
      "durationMs",
      "attempt",
    ]);
    expect(scopeCompletions(["nodes", "intent", "output"], scope).map((c) => c.type)).toEqual([
      "string",
      "number",
    ]);
    expect(scopeCompletions(["nodes", "missing"], scope)).toEqual([]);
  });
});

describe("helpers", () => {
  it("wraps a path as a template and lists every scope path", () => {
    expect(referenceTemplate("input.message")).toBe("{{ input.message }}");
    expect(scopePaths(scope).map((p) => p.path)).toEqual([
      "input.message",
      "input.customer",
      "variables.locale",
      "nodes.intent.output.value",
      "nodes.intent.output.confidence",
      "nodes.urgency.output.value",
    ]);
  });
});
