import { describe, expect, it } from "vitest";
import { sampleFor, scrub, type Placeholder } from "./placeholders.js";

const schema = {
  type: "object",
  required: ["message", "customer"],
  properties: {
    message: { type: "string", "x-dataClass": "pii" },
    tier: { type: "string", enum: ["free", "gold"] },
    customer: {
      type: "object",
      properties: {
        email: { type: "string", format: "email", "x-dataClass": "pii" },
        id: { type: "string" },
        notes: { type: "array", items: { type: "string", "x-dataClass": "sensitive" } },
      },
    },
  },
};

describe("sampleFor", () => {
  it("generates a value from the schema", () => {
    expect(sampleFor(schema)).toEqual({
      message: "example",
      tier: "free",
      customer: { email: "user@example.com", id: "example", notes: ["example"] },
    });
    expect(sampleFor({ type: "integer", minimum: 3 })).toBe(3);
    expect(sampleFor({ type: "string", minLength: 10 })).toBe("examplexxx");
  });
});

describe("scrub", () => {
  it("replaces pii/sensitive fields and $redacted stubs, and lists every replacement", () => {
    const found: Placeholder[] = [];
    const out = scrub(
      {
        message: "My card 4111 was charged twice",
        tier: "gold",
        customer: { email: "ada@example.org", id: "c_1", notes: ["called twice", "angry"] },
        extra: { $redacted: true },
      },
      schema,
      "inputs/example.json#",
      found,
    );
    expect(out).toEqual({
      message: "[redacted]",
      tier: "gold",
      customer: { email: "user@example.com", id: "c_1", notes: ["[redacted]", "[redacted]"] },
      extra: "[redacted]",
    });
    expect(found).toEqual([
      { location: "inputs/example.json#/message", reason: "pii" },
      { location: "inputs/example.json#/customer/email", reason: "pii" },
      { location: "inputs/example.json#/customer/notes/0", reason: "sensitive" },
      { location: "inputs/example.json#/customer/notes/1", reason: "sensitive" },
      { location: "inputs/example.json#/extra", reason: "redacted" },
    ]);
    expect(JSON.stringify(out)).not.toMatch(/4111|ada@|angry/);
  });
});
