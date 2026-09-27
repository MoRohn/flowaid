/**
 * The compiler as the API runs it (ARCHITECTURE.md §2.7): the catalog is the core manifests (plus
 * enabled plugins, later), tools resolve from discovered MCP tools and OpenAPI/workflow toolsets,
 * subflows from deployed or pinned versions, and secret bindings of the target environment enable
 * the unbound-secret diagnostics.
 */
import { and, eq } from "drizzle-orm";
import { coreManifests } from "@flowaid/nodes-core/manifest";
import { compile, COMPILER_VERSION } from "@flowaid/workflow-compiler";
import {
  environments,
  mcpServers,
  secretReferences,
  tools,
  workflowDeployments,
  workflowVersions,
  workspaces,
  type Tx,
} from "@flowaid/database";
import type {
  CompileResult,
  JsonObject,
  NodeCatalog,
  NodeManifest,
  ProviderHop,
  SubflowSignature,
  ToolDefinition,
  ToolSource,
} from "@flowaid/workflow-core";

export function coreCatalog(extra: readonly NodeManifest[] = []): NodeCatalog {
  const manifests = [...coreManifests, ...extra];
  return {
    get: (id, version) =>
      version
        ? manifests.find((m) => m.id === id && m.version === version)
        : manifests.filter((m) => m.id === id).sort((a, b) => (a.version < b.version ? 1 : -1))[0],
    list: () => [...manifests],
  };
}

export interface CompileContextInput {
  workspaceId: string;
  environmentId?: string | null;
  level: "draft" | "publish";
}

/** Loads everything `compile()` resolves against, inside the caller's tenant transaction. */
export async function loadCompileContext(tx: Tx, i: CompileContextInput) {
  const [servers, toolsets, ws] = await Promise.all([
    tx
      .select({ id: mcpServers.id, tools: mcpServers.discoveredTools })
      .from(mcpServers)
      .where(eq(mcpServers.workspaceId, i.workspaceId)),
    tx
      .select({ id: tools.id, kind: tools.kind, defs: tools.definitions })
      .from(tools)
      .where(eq(tools.workspaceId, i.workspaceId)),
    tx
      .select({ settings: workspaces.settings })
      .from(workspaces)
      .where(eq(workspaces.id, i.workspaceId)),
  ]);
  const byKey = new Map<string, ToolDefinition>();
  for (const s of servers) for (const t of s.tools) byKey.set(`mcp|${s.id}|${t.name}`, t);
  for (const ts of toolsets)
    for (const t of ts.defs) {
      if (t.source.kind === "openapi") byKey.set(`openapi|${ts.id}|${t.name}`, t);
      if (t.source.kind === "workflow") byKey.set(`workflow|${t.source.workflowId}`, t);
    }
  const resolveTool = (source: ToolSource): ToolDefinition | undefined => {
    switch (source.kind) {
      case "mcp":
        return byKey.get(`mcp|${source.serverId}|${source.tool}`);
      case "openapi":
        return byKey.get(`openapi|${source.toolsetId}|${source.operationId}`);
      case "workflow":
        return byKey.get(`workflow|${source.workflowId}`);
      case "builtin":
      case "http":
        return undefined;
    }
  };

  let boundSecrets: Set<string> | undefined;
  let envId = i.environmentId ?? null;
  if (!envId) {
    const [prod] = await tx
      .select({ id: environments.id })
      .from(environments)
      .where(and(eq(environments.workspaceId, i.workspaceId), eq(environments.protected, true)));
    envId = prod?.id ?? null;
  }
  if (i.environmentId) {
    const rows = await tx
      .select({ name: secretReferences.secretName })
      .from(secretReferences)
      .where(
        and(
          eq(secretReferences.workspaceId, i.workspaceId),
          eq(secretReferences.environmentId, i.environmentId),
        ),
      );
    boundSecrets = new Set(rows.map((r) => r.name));
  }

  // Subflow signatures: pinned versions, or the version deployed to the target environment.
  const deployed = envId
    ? await tx
        .select({
          workflowId: workflowDeployments.workflowId,
          plan: workflowVersions.plan,
          versionId: workflowVersions.id,
        })
        .from(workflowDeployments)
        .innerJoin(workflowVersions, eq(workflowVersions.id, workflowDeployments.versionId))
        .where(
          and(
            eq(workflowDeployments.workspaceId, i.workspaceId),
            eq(workflowDeployments.environmentId, envId),
            eq(workflowDeployments.active, true),
          ),
        )
    : [];
  const deployedBy = new Map(deployed.map((d) => [d.workflowId, d]));
  const pinned = new Map<string, SubflowSignature | undefined>();
  const signatureOf = (
    versionId: string,
    plan: { inputs: unknown; outputs: unknown; subflows?: { workflowId: string }[] },
  ): SubflowSignature => ({
    versionId,
    inputs: plan.inputs as never,
    outputs: plan.outputs as never,
    references: [...new Set((plan.subflows ?? []).map((s) => s.workflowId))],
  });
  const pinnedIds: string[] = [];
  const resolveSubflow = (
    workflowId: string,
    version: "deployed" | { versionId: string },
  ): SubflowSignature | undefined => {
    if (version === "deployed") {
      const d = deployedBy.get(workflowId);
      return d ? signatureOf(d.versionId, d.plan) : undefined;
    }
    if (!pinned.has(version.versionId)) pinnedIds.push(version.versionId);
    return pinned.get(version.versionId);
  };

  const settings = (ws[0]?.settings ?? {}) as JsonObject;
  const chain = Array.isArray(settings.defaultDecisionChain)
    ? (settings.defaultDecisionChain as unknown as ProviderHop[])
    : [];
  const defaultDecisions =
    chain.length > 0 ? { primary: chain[0] as ProviderHop, failover: chain.slice(1) } : undefined;

  return {
    catalog: coreCatalog(),
    resolveTool,
    resolveSubflow,
    /** Pinned subflow versions are looked up lazily: call after a first compile, then recompile. */
    async loadPinned(): Promise<boolean> {
      const ids = pinnedIds.splice(0).filter((id) => !pinned.has(id));
      if (ids.length === 0) return false;
      for (const id of ids) {
        const [v] = await tx
          .select({ id: workflowVersions.id, plan: workflowVersions.plan })
          .from(workflowVersions)
          .where(and(eq(workflowVersions.id, id), eq(workflowVersions.workspaceId, i.workspaceId)));
        pinned.set(id, v ? signatureOf(v.id, v.plan) : undefined);
      }
      return true;
    },
    ...(boundSecrets ? { boundSecrets } : {}),
    ...(defaultDecisions ? { defaultDecisions } : {}),
    level: i.level,
    compilerVersion: COMPILER_VERSION,
  };
}

export async function compileIn(
  tx: Tx,
  definition: unknown,
  i: CompileContextInput,
): Promise<CompileResult> {
  const c = await loadCompileContext(tx, i);
  let result = compile(definition, c);
  // Pinned subflows resolve on a second pass once their plans are loaded.
  if (await c.loadPinned()) result = compile(definition, c);
  return result;
}

/** node type id → version, for the version row. */
export function catalogSnapshot(plan: {
  nodes: Record<string, { op: { kind: string; type?: string; typeVersion?: string } }>;
}): Record<string, string> {
  const out: Record<string, string> = {};
  for (const n of Object.values(plan.nodes))
    if (n.op.kind === "task" && n.op.type && n.op.typeVersion) out[n.op.type] = n.op.typeVersion;
  return out;
}
