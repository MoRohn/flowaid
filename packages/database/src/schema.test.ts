import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";
import * as schema from "./schema.js";
import { MIGRATIONS_DIR } from "./migrate.js";

const PACKAGE = fileURLToPath(new URL("..", import.meta.url));
const isTable = (v: unknown): v is PgTable =>
  typeof v === "object" && v !== null && Symbol.for("drizzle:IsDrizzleTable") in v;
const exported: unknown[] = Object.values(schema);
const tables = exported.filter(isTable);

describe("schema", () => {
  it("has the 45 tables of DATABASE.md", () => {
    expect(tables).toHaveLength(45);
  });

  it("indexes every tenant table by workspace first (or by a unique key that starts with it)", () => {
    for (const table of tables) {
      const config = getTableConfig(table);
      if (!config.columns.some((c) => c.name === "workspace_id")) continue;
      const leading = [
        ...config.indexes.map((i) => i.config.columns[0]),
        ...config.primaryKeys.map((p) => p.columns[0]),
      ]
        .map((c) => (c && "name" in c ? c.name : ""))
        .filter(Boolean);
      const hasFk = config.foreignKeys.some(
        (f) => f.reference().columns[0]?.name === "workspace_id",
      );
      expect(hasFk, `${config.name} references workspaces`).toBe(true);
      // Tables reached through a parent key (documents → source, chunks → document, …) are exempt.
      if (
        !leading.includes("workspace_id") &&
        ![
          "documents",
          "chunks",
          "evaluation_cases",
          "evaluation_runs",
          "webhook_deliveries",
          "human_task_review_tokens",
          "node_runs",
          "workflow_versions",
          "workflow_deployments",
          "secret_references",
          "mcp_exposures",
          "webhooks",
          "schedules",
          "artifacts",
          "plugins",
          "templates",
        ].includes(config.name)
      ) {
        throw new Error(`${config.name} has no index starting with workspace_id`);
      }
    }
  });

  it("matches the migrations: drizzle-kit generate finds nothing to do", () => {
    // Inside the package, so drizzle-kit resolves the schema's imports the usual way.
    mkdirSync(join(PACKAGE, "node_modules/.cache"), { recursive: true });
    const work = mkdtempSync(join(PACKAGE, "node_modules/.cache/drizzle-check-"));
    try {
      cpSync(MIGRATIONS_DIR, join(work, "migrations"), { recursive: true });
      const before = readdirSync(join(work, "migrations")).sort();
      const output = execFileSync(
        join(PACKAGE, "node_modules/.bin/drizzle-kit"),
        // drizzle-kit resolves both paths against the working directory, even absolute ones.
        [
          "generate",
          "--dialect",
          "postgresql",
          "--schema",
          relative(work, join(PACKAGE, "src/schema.ts")),
          "--out",
          "migrations",
        ],
        { cwd: work, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
      ).toString();
      expect(output).toMatch(/No schema changes/);
      expect(readdirSync(join(work, "migrations")).sort()).toEqual(before);
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }, 60_000);

  it("keeps DATABASE.md and schema.ts identical below the header", () => {
    const doc = readFileSync(join(PACKAGE, "../../docs/design/DATABASE.md"), "utf8");
    const block = doc.slice(doc.indexOf("```ts\n") + 6, doc.indexOf("\n```\n\n## Projections"));
    const code = readFileSync(join(PACKAGE, "src/schema.ts"), "utf8");
    const body = (text: string) => text.slice(text.indexOf('import { sql } from "drizzle-orm";'));
    expect(body(code).trimEnd()).toBe(body(block).trimEnd());
  });
});
