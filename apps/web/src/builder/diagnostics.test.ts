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
