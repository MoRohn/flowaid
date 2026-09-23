import { describe, expect, it } from "vitest";
import {
  contractHash,
  declaredOutcomeKeys,
  escapeOf,
  interfaceHash,
  isInterfaceCompatible,
  labelOf,
  outcomePorts,
  parseContract,
  portForOutcome,
} from "./contract.js";
import { diffContracts } from "./diff.js";
import { lintContract } from "./lint/contract.js";
import { contractLabel, formatStateVersion, parseContractLabel, parseStateVersion } from "./ids.js";
import { rawTemplateContracts, templateContract } from "./test-fixtures.js";

function reverseKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(reverseKeys);
  if (typeof v === "object" && v !== null) {
    return Object.fromEntries(
      Object.entries(v)
        .reverse()
        .map(([k, x]) => [k, reverseKeys(x)]),
    );
  }
  return v;
}

describe("template contracts", () => {
  const all = rawTemplateContracts();

  it("ships at least one contract per harness template", () => {
    expect(new Set(all.map((c) => c.file)).size).toBe(6);
    expect(all.length).toBeGreaterThanOrEqual(9);
  });

  it.each(all.map((c) => [c.file, c.body] as const))(
    "%s parses and lints without errors",
    (_file, body) => {
      const parsed = parseContract(body);
      const lint = lintContract(body);
      expect(
        lint.valid,
        JSON.stringify(lint.diagnostics.filter((d) => d.severity === "error")),
      ).toBe(true);
      expect(declaredOutcomeKeys(parsed).length).toBeGreaterThan(0);
    },
  );
});

describe("contract identity", () => {
  const body = templateContract("support.ticket_router");

  it("labels and hashes a contract independent of key order", () => {
    expect(labelOf(body)).toBe("support.ticket_router@1");
    expect(contractHash(body)).toMatch(/^[0-9a-f]{64}$/);
    expect(contractHash(parseContract(reverseKeys(body)))).toBe(contractHash(body));
  });

  it("changes the hash for a wording change but keeps the interface compatible", () => {
    const edited = parseContract({
      ...body,
      question: {
        ...body.question,
        instructions: `${body.question.instructions} Prefer the queue named in the message.`,
      },
    });
    expect(contractHash(edited)).not.toBe(contractHash(body));
    expect(interfaceHash(edited)).toBe(interfaceHash(body));
    expect(isInterfaceCompatible(body, edited)).toBe(true);
    const diff = diffContracts(body, edited);
    expect(JSON.stringify(diff)).toMatch(/instructions/);
  });

  it("maps outcomes to ports and escapes", () => {
    const ports = outcomePorts(body);
    expect(ports.length).toBeGreaterThan(0);
    expect(portForOutcome(body, "billing")).toBe("billing");
    expect(escapeOf(body, "none")).toBe("none");
    expect(escapeOf(body, "billing")).toBeNull();
  });

  it("rejects a malformed contract with E_JEV_CONTRACT_INVALID", () => {
    const lint = lintContract({ key: "Not A Key", version: 0 });
    expect(lint.valid).toBe(false);
    expect(lint.body).toBeNull();
    expect(lint.diagnostics.every((d) => d.code === "E_JEV_CONTRACT_INVALID")).toBe(true);
  });
});

describe("ids", () => {
  it("round-trips contract labels", () => {
    expect(contractLabel("support.router", 4)).toBe("support.router@4");
    expect(parseContractLabel("support.router@4")).toEqual({ key: "support.router", version: 4 });
    expect(parseContractLabel("support.router")).toBeNull();
  });

  it("round-trips state versions", () => {
    const text = formatStateVersion({
      runId: "0190a1b2-0000-7000-8000-000000000001",
      scope: "",
      seq: 12,
    });
    expect(parseStateVersion(text)).toEqual({
      runId: "0190a1b2-0000-7000-8000-000000000001",
      scope: "",
      seq: 12,
    });
  });
});
