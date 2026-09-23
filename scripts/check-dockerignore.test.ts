/**
 * Repository-level guard for the Docker build context (docker/Dockerfile runs `COPY . .`
 * from the repository root).
 *
 * 1. `.dockerignore` exists and excludes the things that must never reach a build layer or
 *    the BuildKit cache: version control, host dependencies and build output, every `.env*`
 *    file except `.env.example`, and local key material.
 * 2. Every pattern under the `# env & secrets` and `# local data` sections of `.gitignore`
 *    appears in `.dockerignore`, so a secret path that git ignores is never sent to Docker.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

/** `.gitignore` sections whose every pattern must be mirrored in `.dockerignore`. */
const MIRRORED_SECTIONS = ["# env & secrets", "# local data"] as const;

/** Patterns `.dockerignore` must contain regardless of `.gitignore`. */
const REQUIRED_PATTERNS = [
  ".git",
  "**/node_modules",
  "**/dist",
  "**/.next",
  "**/.turbo",
  "**/coverage",
  "**/*.tsbuildinfo",
  ".env",
  ".env.*",
  "!.env.example",
  ".flowaid",
  "data",
  "docs",
  "brand/fonts",
  "playwright-report",
  "test-results",
  ".claude",
  "*.log",
];

/** Non-empty, non-comment lines of an ignore file, in order. */
function patternsOf(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"));
}

/**
 * Canonical form shared by the two ignore syntaxes: gitignore anchors with a leading `/` and
 * marks directories with a trailing `/`; dockerignore patterns are always anchored at the
 * context root and match directories without the slash. `!` negations are kept.
 */
function canonical(pattern: string): string {
  const negated = pattern.startsWith("!");
  let body = negated ? pattern.slice(1) : pattern;
  body = body.replace(/^\//, "").replace(/\/$/, "");
  return `${negated ? "!" : ""}${body}`;
}

/** Patterns listed under each of {@link MIRRORED_SECTIONS} in a gitignore text. */
function sectionPatterns(gitignore: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  let current: string | undefined;
  for (const raw of gitignore.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith("#")) {
      const heading = MIRRORED_SECTIONS.find((section) => line === section);
      current = heading;
      if (heading !== undefined && !out.has(heading)) {
        out.set(heading, []);
      }
      continue;
    }
    if (current === undefined || line === "") {
      continue;
    }
    out.get(current)?.push(line);
  }
  return out;
}

describe(".dockerignore", () => {
  const dockerignore = readFileSync(join(ROOT, ".dockerignore"), "utf8");
  const gitignore = readFileSync(join(ROOT, ".gitignore"), "utf8");
  const dockerPatterns = new Set(patternsOf(dockerignore).map(canonical));

  it("excludes version control, host dependencies, build output, env files and local data", () => {
    const missing = REQUIRED_PATTERNS.filter((pattern) => !dockerPatterns.has(canonical(pattern)));
    expect(missing, "patterns missing from .dockerignore").toEqual([]);
  });

  it("keeps .env.example (the only .env file the image may see)", () => {
    const patterns = patternsOf(dockerignore);
    const envAll = patterns.indexOf(".env.*");
    const keepExample = patterns.indexOf("!.env.example");
    expect(envAll, ".env.* must be listed").toBeGreaterThanOrEqual(0);
    expect(keepExample, "!.env.example must be listed").toBeGreaterThan(envAll);
  });

  it.each(MIRRORED_SECTIONS)("mirrors every pattern of the .gitignore section %s", (section) => {
    const sections = sectionPatterns(gitignore);
    const patterns = sections.get(section);
    expect(patterns, `.gitignore has no section ${section}`).toBeDefined();
    expect(patterns?.length ?? 0, `${section} lists no patterns`).toBeGreaterThan(0);
    const missing = (patterns ?? []).filter((pattern) => !dockerPatterns.has(canonical(pattern)));
    expect(missing, `${section} patterns missing from .dockerignore`).toEqual([]);
  });

  it("parses gitignore sections by their heading only", () => {
    const parsed = sectionPatterns(
      ["# build", "dist/", "", "# env & secrets", ".env", "!.env.example", "# logs", "*.log"].join(
        "\n",
      ),
    );
    expect([...parsed.keys()]).toEqual(["# env & secrets"]);
    expect(parsed.get("# env & secrets")).toEqual([".env", "!.env.example"]);
    expect(canonical("/data/")).toBe("data");
    expect(canonical("!.env.example")).toBe("!.env.example");
  });
});
