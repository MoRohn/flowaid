import { describe, expect, it } from "vitest";
import {
  entriesFor,
  prependRelease,
  syncConstant,
  syncPackageVersions,
} from "./release-version.ts";

describe("release-version", () => {
  it("rewrites PACKAGE_VERSIONS values and nothing else", () => {
    const source = [
      'const OTHER = { shared: "9.9.9" };',
      "export const PACKAGE_VERSIONS: Readonly<Record<string, string>> = {",
      '  shared: "0.1.0",',
      '  "workflow-core": "0.3.8",',
      '  langchain: "0.1.0",',
      "};",
    ].join("\n");
    const next = syncPackageVersions(
      source,
      new Map([
        ["shared", "0.4.0"],
        ["workflow-core", "0.4.0"],
      ]),
    );
    expect(next).toContain('const OTHER = { shared: "9.9.9" };');
    expect(next).toContain('  shared: "0.4.0",');
    expect(next).toContain('  "workflow-core": "0.4.0",');
    expect(next).toContain('  langchain: "0.1.0",');
  });

  it("sets a string constant", () => {
    const source = 'export const SDK_RANGE = "^0.1.0";\nconst SDK_VERSION = "0.1.0";\n';
    expect(syncConstant(syncConstant(source, "SDK_RANGE", "^0.4.0"), "SDK_VERSION", "0.4.0")).toBe(
      'export const SDK_RANGE = "^0.4.0";\nconst SDK_VERSION = "0.4.0";\n',
    );
    expect(() => syncConstant(source, "MISSING", "1")).toThrow(/MISSING/);
  });

  it("takes a version's entries without dependency bumps or commit hashes", () => {
    const changelog = [
      "# @flowaid/api",
      "",
      "## 0.4.0",
      "",
      "### Minor Changes",
      "",
      "- 1a2b3c4: The first public beta.",
      "  More detail on a second line.",
      "",
      "### Patch Changes",
      "",
      "- Updated dependencies [1a2b3c4]",
      "  - @flowaid/shared@0.4.0",
      "- @flowaid/codegen@0.4.0",
      "  - @flowaid/advisor@0.4.0",
      "",
      "## 0.3.0",
      "",
      "- Older.",
    ].join("\n");
    expect(entriesFor(changelog, "0.4.0")).toEqual([
      "- The first public beta.\n  More detail on a second line.",
    ]);
    expect(entriesFor(changelog, "9.9.9")).toEqual([]);
  });

  it("adds the release above the newest one, once", () => {
    const changelog = "# Changelog\n\nIntro.\n\n## 0.3.0 — 2026-09-01\n\n- Older.\n";
    const once = prependRelease(changelog, "0.4.0", "2026-09-28", ["- New."]);
    expect(once).toBe(
      "# Changelog\n\nIntro.\n\n## 0.4.0 — 2026-09-28\n\n- New.\n\n## 0.3.0 — 2026-09-01\n\n- Older.\n",
    );
    expect(prependRelease(once, "0.4.0", "2026-09-29", ["- Again."])).toBe(once);
  });
});
