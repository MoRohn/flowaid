import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createZip, readZip } from "./zip.js";

const text = (s: string) => new TextEncoder().encode(s);

describe("zip", () => {
  const entries = [
    { path: "pkg/README.md", data: text("# hello\n".repeat(100)) },
    { path: "pkg/src/ü.ts", data: text("export const x = 1;\n") },
    { path: "pkg/empty", data: new Uint8Array() },
    { path: "pkg/bin.tgz", data: new Uint8Array([0, 1, 2, 255, 254]) },
  ];

  it("round-trips entries (stored and deflated, UTF-8 names)", () => {
    const back = readZip(createZip(entries));
    expect([...back.keys()]).toEqual(entries.map((e) => e.path));
    for (const e of entries) expect(back.get(e.path)).toEqual(e.data);
  });

  it("is deterministic", () => {
    expect(createZip(entries)).toEqual(createZip(entries));
  });

  it("rejects unsafe and duplicate paths", () => {
    for (const path of ["../x", "/abs", "a/../b", "a\\b", ""])
      expect(() => createZip([{ path, data: new Uint8Array() }])).toThrow(/unsafe/);
    expect(() =>
      createZip([
        { path: "a", data: new Uint8Array() },
        { path: "a", data: new Uint8Array() },
      ]),
    ).toThrow(/duplicate/);
  });

  it("is readable by the system unzip", () => {
    const dir = mkdtempSync(join(tmpdir(), "flowaid-zip-"));
    try {
      const file = join(dir, "a.zip");
      writeFileSync(file, createZip(entries));
      let listing: string;
      try {
        listing = execFileSync("unzip", ["-t", file], { encoding: "utf8" });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return; // no unzip on this machine
        throw error;
      }
      expect(listing).toMatch(/No errors detected/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
