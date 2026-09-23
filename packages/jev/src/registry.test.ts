import { describe, expect, it } from "vitest";
import { ContractRegistry } from "./registry.js";
import { parseContract } from "./contract.js";
import { templateContract } from "./test-fixtures.js";

const body = templateContract("support.ticket_router");
let n = 0;
const registry = (): ContractRegistry =>
  new ContractRegistry({
    now: () => "2026-09-23T10:00:00.000Z",
    newId: () => `0190a1b2-0000-7000-8000-${String((n += 1)).padStart(12, "0")}`,
  });

describe("contract registry", () => {
  it("registers version 1 in review and refuses a skipped version", () => {
    const reg = registry();
    const sub = reg.register(body, "author");
    expect(sub.ok).toBe(true);
    if (!sub.ok) return;
    expect(sub.value.version.status).toBe("in_review");
    expect(sub.value.diff).toBeNull();
    expect(reg.nextVersion(body.key)).toBe(2);
    const skipped = reg.saveDraft(parseContract({ ...body, version: 3 }), "author");
    expect(skipped.ok).toBe(false);
  });

  it("reports an unknown key", () => {
    expect(registry().get("nope.key", 1)).toBeUndefined();
    expect(registry().latestApproved("nope.key")).toBeUndefined();
  });
});
