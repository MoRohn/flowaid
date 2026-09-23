import { describe, expect, it } from "vitest";
import {
  buildOptionSet,
  dynamicMenuOf,
  isOptionSetStale,
  optionKey,
  optionSetCriteria,
} from "./menu.js";
import { templateContract } from "./test-fixtures.js";

const contract = templateContract("research.next_source");
const menu = dynamicMenuOf(contract);
const at = { builtAt: "2026-09-23T10:00:00.000Z", builtAtSeq: 3 };
interface Src {
  id: string;
  d: string;
  cost?: number;
}
const cfg = { id: (c: Src) => c.id, description: (c: Src) => c.d };

describe("live option menus", () => {
  it("finds the dynamic menu of a contract", () => {
    expect(menu?.source).toBe("dynamic");
    expect(dynamicMenuOf(templateContract("support.ticket_router"))).toBeNull();
  });

  it("dedupes candidates, keys them and appends the escape hatches", () => {
    if (!menu) throw new Error("menu");
    const r = buildOptionSet(
      menu,
      [
        { id: "docs", d: "Official docs cover the API" },
        { id: "blog", d: "Launch post" },
        { id: "docs", d: "dup" },
      ],
      cfg,
      at,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.optionSet.entries.map((e) => e.key)).toEqual(["docs", "blog", "stop", "review"]);
    expect(r.optionSet.counts.original).toBe(3);
    expect(Object.keys(optionSetCriteria(r.optionSet))).toContain("stop");
    const same = buildOptionSet(
      menu,
      [
        { id: "docs", d: "Official docs cover the API" },
        { id: "blog", d: "Launch post" },
      ],
      cfg,
      at,
    );
    expect(same.ok && same.optionSet.version).toBe(r.optionSet.version);
  });

  it("never exceeds the TypeSafe 255-option limit", () => {
    if (!menu) throw new Error("menu");
    const many = Array.from({ length: 400 }, (_, i) => ({ id: `s${i}`, d: `Source ${i}` }));
    const r = buildOptionSet(menu, many, { ...cfg, overflow: "truncate" }, at);
    if (r.ok) expect(r.optionSet.entries.length).toBeLessThanOrEqual(255);
    const refused = buildOptionSet(menu, many, { ...cfg, overflow: "error" }, at);
    expect(refused.ok).toBe(false);
  });

  it("drops candidates over budget and marks an old set stale", () => {
    if (!menu) throw new Error("menu");
    const r = buildOptionSet(
      menu,
      [
        { id: "cheap", d: "Cheap", cost: 0.01 },
        { id: "pricey", d: "Pricey", cost: 5 },
      ],
      { ...cfg, cost: { by: (c: Src) => c.cost ?? 0, remainingUsd: 1 } },
      at,
    );
    expect(r.ok && r.optionSet.entries.map((e) => e.key)).not.toContain("pricey");
    if (r.ok) {
      expect(isOptionSetStale(r.optionSet, menu, "2026-09-23T10:00:01.000Z")).toBe(false);
      expect(isOptionSetStale(r.optionSet, menu, "2026-09-23T11:00:00.000Z")).toBe(true);
    }
  });

  it("derives slug keys from ids", () => {
    expect(optionKey("Official Docs!")).toBe("official_docs");
    expect(optionKey("42")).toBe("o_42");
    expect(optionKey("Café")).toBe("cafe");
  });

  it("treats a set built before newer inputs as stale", () => {
    if (!menu) throw new Error("menu");
    const r = buildOptionSet(menu, [{ id: "docs", d: "Docs" }], cfg, at);
    if (!r.ok) throw new Error("set");
    expect(isOptionSetStale(r.optionSet, menu, at.builtAt, 4)).toBe(true);
    expect(isOptionSetStale(r.optionSet, menu, at.builtAt, 3)).toBe(false);
  });
});
