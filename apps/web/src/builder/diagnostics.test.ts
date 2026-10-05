import { describe, expect, it } from "vitest";
import type { Diagnostic, WorkflowDefinition } from "@flowaid/workflow-core";
import { blankDefinition } from "./model";
import { diagnosticNodeId, presentDiagnostic } from "./diagnostics";

const def = (): WorkflowDefinition => {
  const d = blankDefinition("3e7a1c9b-8d2f-4b6e-9a0c-5f4d3e2b1a09", "Test");
  d.nodes.splice(1, 0, {
    id: "generate_1",
    kind: "task",
    type: "flowaid.ai.generate",
    typeVersion: "1.0.0",
    name: "Generate text",
    config: {},
    inputs: {},
    credentials: {},
    disabled: false,
  } as never);
  return d;
};

describe("presentDiagnostic", () => {
  it("names the node and field instead of the pointer, and drops the repeated pointer", () => {
    const d: Diagnostic = {
      code: "E_SCHEMA",
      severity: "error",
      message: "/nodes/1/config/system: Invalid input",
      location: { path: "/nodes/1/config/system" },
    };
    expect(presentDiagnostic(d, def())).toEqual({
      where: "Generate text › system",
      message: "Invalid input",
    });
    expect(diagnosticNodeId(d, def())).toBe("generate_1");
  });

  it("leads a run limit problem to the Execution settings", () => {
    const cost: Diagnostic = {
      code: "W_COST_ESTIMATE",
      severity: "warning",
      message: "No cost bound: set execution.maxCostUsd, or maxCostUsd on 'generate_1'",
      location: { path: "/execution" },
    };
    expect(presentDiagnostic(cost, def())).toMatchObject({
      remedy: "cost-limit",
      hint: expect.stringContaining("cost limit per run under Execution") as unknown,
    });
    const expiry: Diagnostic = {
      code: "W_HUMAN_EXPIRY_EXCEEDS_RUN_TIMEOUT",
      severity: "warning",
      message: "'generate_1' waits up to 2 h for a person, but the run stops after 3 min",
      location: { nodeId: "generate_1" },
    };
    expect(presentDiagnostic(expiry, def()).remedy).toBe("time-limit");
  });

  it("says what to do about a missing key", () => {
    const d: Diagnostic = {
      code: "E_CREDENTIAL_SLOT_UNBOUND",
      severity: "error",
      message: "Credential slot 'llm' (openai.api_key) is required",
      location: { nodeId: "generate_1" },
    };
    const shown = presentDiagnostic(d, def());
    expect(shown.where).toBe("Generate text");
    expect(shown.remedy).toBe("credential");
    expect(shown.hint).toMatch(/needs a key/);
  });
});

describe("presentDiagnostic for template placeholders", () => {
  it("sends a knowledge placeholder to the node and the Knowledge page", () => {
    const d: Diagnostic = {
      code: "E_TOOL_UNRESOLVED",
      severity: "error",
      message:
        "Choose the knowledge source for Documents › Source IDs › item 1: this node came from a template and still holds the placeholder $template.knowledge.documents",
      location: { nodeId: "generate_1", path: "/nodes/1/config/documents/sourceIds/0" },
    };
    const shown = presentDiagnostic(d, def());
    expect(shown.remedy).toBe("knowledge");
    expect(shown.hint).toMatch(/knowledge source/);
  });
});

describe("presentDiagnostic at a node's config root", () => {
  it("names just the node, not “› config”", () => {
    const d: Diagnostic = {
      code: "E_CONFIG_INVALID",
      severity: "error",
      message: "Threshold is required",
      location: { nodeId: "generate_1", path: "/nodes/1/config" },
    };
    expect(presentDiagnostic(d, def()).where).toBe("Generate text");
  });
});
