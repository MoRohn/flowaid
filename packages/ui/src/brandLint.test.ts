// @vitest-environment node
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

/** The package root (this file sits in `src/`). */
function packageRoot(): string {
  const testPath = expect.getState().testPath;
  if (!testPath) throw new Error("vitest did not report the test path");
  return dirname(dirname(testPath));
}

// Built from parts so this file does not itself trip the rules it tests.
const OPEN = "[";
const arbitrarySize = (size: string) => `text-${OPEN}${size}]`;
const RGBA = "rgba";

async function restrictedSyntaxMessages(code: string): Promise<string[]> {
  const eslint = new ESLint({ cwd: packageRoot() });
  // An existing source path, so the type-aware parser resolves it in the ui project.
  const [result] = await eslint.lintText(code, { filePath: "src/primitives/Badge.tsx" });
  return (result?.messages ?? [])
    .filter((m) => m.ruleId === "no-restricted-syntax")
    .map((m) => m.message);
}

// The first lint builds the type-aware program for the whole package, which takes several
// seconds on a cold CI runner.
describe("ui lint: brand conformance", { timeout: 60_000 }, () => {
  it("fails on a reintroduced arbitrary text size, in a string or a template", async () => {
    const messages = await restrictedSyntaxMessages(
      [
        `export const a = "font-mono ${arbitrarySize("10px")} text-ink-3";`,
        `export const b = (on: boolean) => \`h-4 \${on ? "x" : "y"} ${arbitrarySize("9px")}\`;`,
        `export const c = "font-mono text-2xs text-ink-3";`,
        "",
      ].join("\n"),
    );
    expect(messages).toHaveLength(2);
    for (const m of messages) expect(m).toMatch(/11px floor/);
  });

  it(`fails on a raw ${RGBA}( colour`, async () => {
    const messages = await restrictedSyntaxMessages(
      [
        `export const s = "shadow-[0_1px_2px_${RGBA}(0,0,0,0.25)]";`,
        `export const t = "shadow-1";`,
        "",
      ].join("\n"),
    );
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatch(/tokens/);
  });

  it("still bans process.env reads alongside the brand selectors", async () => {
    const messages = await restrictedSyntaxMessages("export const e = process.env.NODE_ENV;\n");
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatch(/process\.env/);
  });
});

function cssFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...cssFiles(path));
    else if (name.endsWith(".css")) out.push(path);
  }
  return out;
}

describe("ui stylesheets: brand conformance", () => {
  it("never set a font size below the 11px floor", () => {
    const src = join(packageRoot(), "src");
    const offenders: string[] = [];
    for (const file of cssFiles(src)) {
      const css = readFileSync(file, "utf8");
      for (const m of css.matchAll(/font-size:\s*([\d.]+)(px|rem)/g)) {
        const px = m[2] === "rem" ? Number(m[1]) * 16 : Number(m[1]);
        if (px < 11) offenders.push(`${relative(src, file)}: ${m[0]}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it(`keep raw ${RGBA}( colours inside the token file`, () => {
    const src = join(packageRoot(), "src");
    const offenders = cssFiles(src)
      .filter((f) => !f.endsWith("tokens.css"))
      .filter((f) => readFileSync(f, "utf8").includes(`${RGBA}(`))
      .map((f) => relative(src, f));
    expect(offenders).toEqual([]);
  });
});
