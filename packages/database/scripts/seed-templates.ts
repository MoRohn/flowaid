/**
 * Loads the three demo templates (support triage, GitHub issue triage, research agent) with their
 * required resources from workflow-core's fixtures. Run as the owner:
 *
 *   DATABASE_URL=… pnpm --filter @flowaid/database seed:templates
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadEnv } from "@flowaid/env";
import type { WorkflowDefinition } from "@flowaid/workflow-core";
import { createDatabase } from "../src/db.js";
import { seedTemplates, type BuiltInTemplate, type RequiredResources } from "../src/seeds.js";

const FIXTURES = fileURLToPath(new URL("../../workflow-core/fixtures/", import.meta.url));
const read = <T>(file: string): T => JSON.parse(readFileSync(`${FIXTURES}${file}`, "utf8")) as T;

export const DEMO_TEMPLATES: BuiltInTemplate[] = [
  { slug: "support-triage", category: "support", file: "support-triage" },
  { slug: "github-issue-triage", category: "engineering", file: "github-issue-triage" },
  { slug: "research-agent", category: "research", file: "research-agent" },
].map(({ slug, category, file }) => ({
  slug,
  category,
  definition: read<WorkflowDefinition>(`${file}.json`),
  requiredResources: read<RequiredResources>(`templates/${file}.resources.json`),
}));

const env = loadEnv();
const database = createDatabase({
  url: String(env.DATABASE_ADMIN_URL ?? env.DATABASE_URL),
  rls: false,
  max: 1,
});
try {
  const n = await database.system((tx) => seedTemplates(tx, DEMO_TEMPLATES));
  console.log(`seeded ${n} templates`);
} finally {
  await database.close();
}
