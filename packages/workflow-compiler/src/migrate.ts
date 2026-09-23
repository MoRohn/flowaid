/**
 * `migrateDefinition(def, catalog)` (ARCHITECTURE.md §4.7). Moves every task node to the newest
 * manifest of its type that declares a migration from the node's version (`migrations` lists the
 * versions a manifest migrates from), following the chain one version at a time. The compiler
 * never runs node code, so config transformations are supplied by the caller (`transform`, fed
 * from the node SDK's migrators); without one, config is carried over unchanged.
 */
import {
  WorkflowDefinitionSchema,
  type JsonObject,
  type NodeCatalog,
  type WorkflowDefinition,
} from "@flowaid/workflow-core";
import { cloneJson } from "./util.js";

export interface MigrationStep {
  node: string;
  from: string;
  to: string;
}

export interface MigrateOptions {
  /** Rewrites a node's config for one step; return the new config. */
  transform?: (step: MigrationStep & { type: string; config: JsonObject }) => JsonObject;
}

function compareSemver(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i += 1) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return Math.sign(d);
  }
  return 0;
}

export function migrateDefinition(
  definition: unknown,
  catalog: NodeCatalog,
  options: MigrateOptions = {},
): { def: WorkflowDefinition; applied: MigrationStep[] } {
  const def = cloneJson(WorkflowDefinitionSchema.parse(definition));
  const applied: MigrationStep[] = [];
  for (const node of def.nodes) {
    if (node.kind !== "task") continue;
    const versions = catalog
      .list()
      .filter((m) => m.id === node.type)
      .sort((x, y) => compareSemver(x.version, y.version));
    // Walk forward: at each step take the newest manifest that migrates from the current version.
    for (;;) {
      const current = node.typeVersion;
      const next = [...versions]
        .reverse()
        .find((m) => compareSemver(m.version, current) > 0 && m.migrations.includes(current));
      if (!next) break;
      const step = { node: node.id, from: current, to: next.version };
      if (options.transform) {
        node.config = options.transform({ ...step, type: node.type, config: node.config });
      }
      node.typeVersion = next.version;
      applied.push(step);
    }
  }
  return { def, applied };
}
