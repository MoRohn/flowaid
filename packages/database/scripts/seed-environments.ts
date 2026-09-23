/**
 * Creates the default environments (dev, staging, prod — prod protected) of a workspace. The API
 * does this when it creates a workspace; this script repairs older workspaces:
 *
 *   pnpm --filter @flowaid/database seed:environments <workspace-slug>
 */
import { loadEnv } from "@flowaid/env";
import { createDatabase } from "../src/db.js";
import { getWorkspaceBySlug, seedEnvironments } from "../src/repositories/workspaces.js";

const slug = process.argv[2];
if (!slug) {
  console.error("usage: seed-environments.ts <workspace-slug>");
  process.exit(2);
}
const env = loadEnv();
const database = createDatabase({
  url: String(env.DATABASE_ADMIN_URL ?? env.DATABASE_URL),
  rls: false,
  max: 1,
});
try {
  const created = await database.system(async (tx) => {
    const ws = await getWorkspaceBySlug(tx, slug);
    if (!ws) throw new Error(`No workspace '${slug}'`);
    return seedEnvironments(tx, ws.id);
  });
  console.log(created.map((e) => `${e.name}${e.protected ? " (protected)" : ""}`).join(", "));
} finally {
  await database.close();
}
