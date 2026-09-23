/**
 * UI.md §3 is generated from the fourteen `packages/ui/src/<group>/index.ts` files.
 * This test fails when the checked-in table diverges from the exports (run
 * `pnpm ui:inventory` to regenerate) and guards the generator itself.
 *
 * Runs in the root Vitest project (`pnpm boundaries`).
 */
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  DEPRECATED,
  LATER_PHASE,
  PLANNED,
  UI_DOC,
  UI_GROUPS,
  collectInventory,
  currentInventoryBlock,
  formatInventory,
  injectInventory,
  renderInventory,
  valueExportsOf,
} from "./ui-inventory.js";

describe("ui inventory", () => {
  const inventory = collectInventory();

  it("reads every group index and finds exports in each", () => {
    expect(inventory.map((g) => g.group)).toEqual([...UI_GROUPS]);
    expect(UI_GROUPS).toHaveLength(14);
    for (const { group, exports } of inventory) {
      expect(exports.length, group).toBeGreaterThan(0);
      expect(new Set(exports).size, `${group} exports are unique`).toBe(exports.length);
    }
  });

  it("keeps the annotations honest: later-phase and deprecated names exist, planned names do not", () => {
    for (const { group, exports } of inventory) {
      const names = new Set(exports);
      for (const name of LATER_PHASE[group] ?? [])
        expect(names.has(name), `${group}.${name}`).toBe(true);
      for (const name of DEPRECATED[group] ?? [])
        expect(names.has(name), `${group}.${name}`).toBe(true);
      for (const name of PLANNED[group] ?? [])
        expect(names.has(name), `${group}.${name} is exported: drop it from PLANNED`).toBe(false);
    }
  });

  it("matches the table checked into docs/design/UI.md §3", async () => {
    const doc = readFileSync(UI_DOC, "utf8");
    const block = await formatInventory(renderInventory(inventory));
    expect(currentInventoryBlock(doc)).toBe(block);
    expect(injectInventory(doc, block)).toBe(doc);
  });

  it("prints the block the way Prettier does, so pnpm format leaves it alone", async () => {
    const block = await formatInventory(renderInventory(inventory));
    expect(await formatInventory(block)).toBe(block);
    for (const { group, exports } of inventory) {
      const row = block.split("\n").find((line) => line.startsWith(`| \`${group}\``));
      expect(row, group).toBeDefined();
      for (const name of exports) expect(row, `${group}.${name}`).toContain(`\`${name}\``);
    }
  });

  it("follows named re-exports, export * and exported declarations, skipping types", () => {
    const dir = mkdtempSync(join(tmpdir(), "ui-inventory-"));
    mkdirSync(join(dir, "nested"));
    writeFileSync(
      join(dir, "a.ts"),
      "export const A = 1;\nexport function fa() {}\nexport type TA = string;\nexport interface IA {}\n",
    );
    writeFileSync(join(dir, "nested", "index.ts"), 'export * from "../a";\nexport class C {}\n');
    writeFileSync(
      join(dir, "index.ts"),
      'export { A as Alias, fa, type TA } from "./a";\nexport type { IA } from "./a";\nexport * from "./nested";\nexport const B = 2;\nexport enum E { X }\n',
    );
    expect(valueExportsOf(join(dir, "index.ts"))).toEqual(["Alias", "fa", "A", "C", "B", "E"]);
  });
});
