import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { FIXTURE_NODES } from "./test/fixtureNodes.js";
import { toManifest } from "./toManifest.js";

const MANIFESTS = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../workflow-core/fixtures/manifests",
);

describe.each(FIXTURE_NODES.map((def) => [def.id, def] as const))("toManifest(%s)", (id, def) => {
  it("deep-equals the checked-in fixture manifest", () => {
    const expected: unknown = JSON.parse(readFileSync(join(MANIFESTS, `${id}.json`), "utf8"));
    expect(toManifest(def)).toEqual(expected);
  });
});
