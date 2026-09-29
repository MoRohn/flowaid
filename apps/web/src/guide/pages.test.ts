import { describe, expect, it } from "vitest";
import { NAV, NAV_SECONDARY } from "~/shell/nav";
import { BUILDER_GUIDE, GLOSSARY, PAGE_GUIDES, RUN_GUIDE, sectionOf } from "./pages";

describe("page guides", () => {
  it("covers every section in the navigation", () => {
    const missing = [...NAV, ...NAV_SECONDARY]
      .map((e) => e.path)
      .filter((path) => !(path in PAGE_GUIDES));
    expect(missing).toEqual([]);
  });

  it("only uses words the glossary explains", () => {
    const used = [...Object.values(PAGE_GUIDES), BUILDER_GUIDE, RUN_GUIDE].flatMap((g) => g.terms);
    expect(used.filter((t) => !GLOSSARY[t])).toEqual([]);
  });

  it("finds the section from a path", () => {
    expect(sectionOf("/acme")).toBe("");
    expect(sectionOf("/acme/templates")).toBe("templates");
    expect(sectionOf("/acme/runs/01a0ee42")).toBe("runs");
  });
});
