/**
 * Contract parity for CONTRACTS.ts §16: every exported §16 name is exported by this package
 * (types from the modules index.ts re-exports, values at runtime). Adding, renaming or dropping
 * one without an RFC fails here.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as sdk from "./index.js";

const SRC = dirname(fileURLToPath(import.meta.url));
const CONTRACTS = readFileSync(resolve(SRC, "../../../docs/design/CONTRACTS.ts"), "utf8");
const EXPORT_RE =
  /^export\s+(?:declare\s+)?(const|function|class|type|interface)\s+([A-Za-z_$][\w$]*)/;
const SECTION_RE = /^\s*\*\s+§(\d+)\b/;

function section16(): { name: string; kind: "value" | "type" }[] {
  const out: { name: string; kind: "value" | "type" }[] = [];
  let section = 0;
  for (const line of CONTRACTS.split("\n")) {
    const s = SECTION_RE.exec(line);
    if (s?.[1] !== undefined) section = Number(s[1]);
    const m = EXPORT_RE.exec(line);
    if (section !== 16 || m?.[1] === undefined || m[2] === undefined) continue;
    out.push({ name: m[2], kind: m[1] === "type" || m[1] === "interface" ? "type" : "value" });
  }
  return out;
}

function exportedTypes(): Set<string> {
  const names = new Set<string>();
  for (const file of ["types.ts", "define.ts", "toManifest.ts"]) {
    const text = readFileSync(join(SRC, file), "utf8");
    for (const m of text.matchAll(
      /^export\s+(?:type|interface|function|const)\s+([A-Za-z_$][\w$]*)/gm,
    )) {
      if (m[1]) names.add(m[1]);
    }
    for (const m of text.matchAll(/^export type \{ ([^}]+) \}/gm))
      for (const n of (m[1] ?? "").split(",")) names.add(n.trim());
  }
  return names;
}

describe("CONTRACTS.ts §16 parity", () => {
  const contract = section16();

  it("finds the section", () => {
    expect(contract.length).toBeGreaterThan(20);
  });

  it("exports every §16 value at runtime", () => {
    for (const { name } of contract.filter((c) => c.kind === "value")) {
      expect(sdk, name).toHaveProperty(name);
    }
  });

  it("declares every §16 type", () => {
    const types = exportedTypes();
    for (const { name } of contract.filter((c) => c.kind === "type"))
      expect(types, name).toContain(name);
  });
});
