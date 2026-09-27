/**
 * Plugins (API.md §3.9, ARCHITECTURE.md §3.5). The API never loads plugin code: an install
 * resolves the package against the registry (`FLOWAID_PLUGIN_REGISTRY`), checks the allow-list
 * (`FLOWAID_PLUGIN_ALLOWED_SCOPES`), the discovery contract and the node SDK range, verifies the
 * tarball against its published integrity (optionally a pinned one, `--frozen`), reads the node
 * manifests the package ships and records a workspace `plugins` row. The worker installs the same
 * verified tarball and loads it on its next start (`workerRestartRequired`). Bundled rows (shipped
 * in the worker image) accept only `status`, only from an owner, and cannot be removed.
 */
import { readFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { and, eq, isNull, or } from "drizzle-orm";
import { plugins, type Tx } from "@flowaid/database";
import {
  PluginProblem,
  RegistryClient,
  checkPluginVersion,
  integrityOf,
  isAllowed,
  isPackageName,
  manifestsFromFiles,
  resolvePlugin,
  type ResolvedPlugin,
} from "@flowaid/plugins";
import { uuidv7 } from "@flowaid/shared";
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  FlowaidError,
  NotFoundError,
  WorkerPoolSchema,
  type NodeManifest,
} from "@flowaid/workflow-core";
import { roleAtLeast } from "../auth/scopes.js";
import type { Principal } from "../auth/principal.js";
import type { ApiContext } from "../context.js";
import { IdParams, NoContent } from "../dto/common.js";

type PluginRow = typeof plugins.$inferSelect;

/** 422: the package is not an installable FlowAId plugin (details.reason names the check). */
export class PluginRejected extends FlowaidError {
  readonly code = "WORKFLOW_VALIDATION_ERROR" as const;
  readonly retryable = false;
  override readonly httpStatus = 422;
}

export const PluginSchema = z.object({
  id: z.uuid(),
  packageName: z.string(),
  version: z.string(),
  source: z.enum(["npm", "local", "bundled"]),
  integrity: z.string().nullable(),
  status: z.enum(["enabled", "disabled", "error"]),
  pool: z.string(),
  error: z.string().nullable(),
  scope: z.enum(["global", "workspace"]),
  nodes: z.array(
    z.object({ id: z.string(), name: z.string(), category: z.string(), version: z.string() }),
  ),
  installedAt: z.string(),
});

const InstalledSchema = z.object({ plugin: PluginSchema, workerRestartRequired: z.boolean() });

export const PluginInstallRequestSchema = z.object({
  packageName: z.string().min(1).max(214),
  /** exact version, semver range or dist-tag; default `latest` */
  version: z.string().min(1).max(100).default("latest"),
  source: z.enum(["npm", "local"]).default("npm"),
  /** `--frozen`: refuse the install unless the tarball's integrity is exactly this */
  integrity: z.string().max(200).optional(),
  /** `source: local` only: an absolute directory on the platform host */
  path: z.string().max(1000).optional(),
});

const SearchResultSchema = z.object({
  name: z.string(),
  version: z.string(),
  description: z.string(),
  keywords: z.array(z.string()),
  publisher: z.string().nullable(),
  date: z.string().nullable(),
  links: z.object({
    npm: z.string().optional(),
    repository: z.string().optional(),
    homepage: z.string().optional(),
  }),
  score: z.number(),
  allowed: z.boolean(),
  installed: z.string().nullable(),
});

export function pluginDto(row: PluginRow) {
  return {
    id: row.id,
    packageName: row.packageName,
    version: row.version,
    source: row.source,
    integrity: row.integrity,
    status: row.status,
    pool: row.pool,
    error: row.error,
    scope: row.workspaceId === null ? ("global" as const) : ("workspace" as const),
    nodes: row.manifests.map((m) => ({
      id: m.id,
      name: m.metadata.name,
      category: m.metadata.category,
      version: m.version,
    })),
    installedAt: row.installedAt.toISOString(),
  };
}

function problemToError(e: unknown): never {
  if (!(e instanceof PluginProblem)) throw e;
  const details = { reason: e.code };
  switch (e.code) {
    case "E_PLUGIN_NOT_ALLOWED":
    case "E_PLUGIN_LOCAL_DISABLED":
      throw new ForbiddenError(e.message, details);
    case "E_PLUGIN_NOT_FOUND":
      throw new NotFoundError(e.message, details);
    case "E_PLUGIN_NOT_A_PLUGIN":
    case "E_PLUGIN_SDK_RANGE":
    case "E_PLUGIN_INTEGRITY":
    case "E_PLUGIN_MANIFEST":
    case "E_PLUGIN_ID_PREFIX":
      throw new PluginRejected(e.message, details);
  }
}

/** A local package directory (FLOWAID_PLUGIN_ALLOW_LOCAL): package.json + its manifest file. */
async function resolveLocal(name: string, dir: string): Promise<ResolvedPlugin> {
  if (!isAbsolute(dir)) throw new BadRequestError("path must be an absolute directory");
  let pkg: {
    name?: string;
    version?: string;
    description?: string;
    keywords?: string[];
    flowaid?: { package?: string; sdk?: string; manifest?: string };
  };
  try {
    pkg = JSON.parse(await readFile(join(dir, "package.json"), "utf8")) as typeof pkg;
  } catch {
    throw new BadRequestError(`no readable package.json in ${dir}`);
  }
  if (pkg.name !== name)
    throw new BadRequestError(`${dir} holds ${pkg.name ?? "no package"}, not ${name}`);
  const { sdk, manifestPath } = checkPluginVersion({
    name,
    version: pkg.version ?? "0.0.0",
    ...(pkg.keywords ? { keywords: pkg.keywords } : {}),
    ...(pkg.flowaid ? { flowaid: pkg.flowaid } : {}),
    dist: { tarball: "" },
  });
  let data: Uint8Array;
  try {
    data = await readFile(join(dir, manifestPath));
  } catch {
    throw new PluginProblem("E_PLUGIN_MANIFEST", `${name} has no ${manifestPath} in ${dir}`);
  }
  return {
    name,
    version: pkg.version ?? "0.0.0",
    description: pkg.description ?? "",
    // local code is not registry-verified; record the manifest's digest for change detection
    integrity: `local:${integrityOf(data)}`,
    tarball: dir,
    sdk,
    manifests: manifestsFromFiles(
      name,
      [{ path: manifestPath.replace(/^\.?\//, ""), data }],
      manifestPath,
    ),
  };
}

async function visiblePlugin(tx: Tx, workspaceId: string, id: string): Promise<PluginRow> {
  const [row] = await tx
    .select()
    .from(plugins)
    .where(
      and(
        eq(plugins.id, id),
        or(isNull(plugins.workspaceId), eq(plugins.workspaceId, workspaceId)),
      ),
    );
  if (!row) throw new NotFoundError("plugin not found");
  return row;
}

/** Node type ids a new package would add that another visible plugin already owns. */
function conflictingIds(
  existing: readonly PluginRow[],
  name: string,
  manifests: readonly NodeManifest[],
): string[] {
  const taken = new Set(
    existing.filter((p) => p.packageName !== name).flatMap((p) => p.manifests.map((m) => m.id)),
  );
  return manifests.map((m) => m.id).filter((id) => taken.has(id));
}

function need(p: Principal | null | undefined): Principal {
  if (!p) throw new ForbiddenError("no principal");
  return p;
}

export function pluginRoutes(app: FastifyInstance, ctx: ApiContext): void {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const registry = () =>
    new RegistryClient({ registry: ctx.config.plugins.registry, fetch: ctx.http });

  r.get(
    "/v1/plugins",
    {
      config: {
        auth: "session_or_api_key",
        scope: "tools:read",
        cli: { noun: "plugin", verb: "list" },
      },
      schema: {
        tags: ["plugins"],
        summary: "Installed and bundled node packages",
        response: { 200: z.array(PluginSchema) },
      },
    },
    async (req) => {
      const p = need(req.principal);
      const rows = await ctx.db.tenant(p.workspaceId, (tx) =>
        tx
          .select()
          .from(plugins)
          .where(or(isNull(plugins.workspaceId), eq(plugins.workspaceId, p.workspaceId)))
          .orderBy(plugins.packageName),
      );
      return rows.map(pluginDto);
    },
  );

  r.get(
    "/v1/plugins/search",
    {
      config: {
        auth: "session_or_api_key",
        scope: "tools:read",
        cli: { noun: "plugin", verb: "discover" },
      },
      schema: {
        tags: ["plugins"],
        summary: "Search the registry for node packages (keyword flowaid-node)",
        querystring: z.object({
          q: z.string().max(200).default(""),
          size: z.coerce.number().int().min(1).max(100).default(20),
        }),
        response: { 200: z.array(SearchResultSchema) },
      },
    },
    async (req) => {
      const p = need(req.principal);
      const [results, rows] = await Promise.all([
        registry().search(req.query.q, req.query.size),
        ctx.db.tenant(p.workspaceId, (tx) =>
          tx
            .select({ name: plugins.packageName, version: plugins.version })
            .from(plugins)
            .where(or(isNull(plugins.workspaceId), eq(plugins.workspaceId, p.workspaceId))),
        ),
      ]);
      const installed = new Map(rows.map((x) => [x.name, x.version]));
      return results.map((x) => ({
        ...x,
        allowed: isAllowed(x.name, ctx.config.plugins.allowList),
        installed: installed.get(x.name) ?? null,
      }));
    },
  );

  r.post(
    "/v1/plugins",
    {
      config: {
        auth: "session_or_api_key",
        scope: "admin",
        audit: { action: "plugin.install", resource: "plugin" },
        cli: { noun: "plugin", verb: "install" },
      },
      schema: {
        tags: ["plugins"],
        summary: "Install (or upgrade) a node package for this workspace",
        body: PluginInstallRequestSchema,
        response: { 201: InstalledSchema },
      },
    },
    async (req, reply) => {
      const p = need(req.principal);
      const b = req.body;
      if (!isPackageName(b.packageName))
        throw new BadRequestError(`"${b.packageName}" is not an npm package name`);
      let resolved: ResolvedPlugin;
      try {
        if (b.source === "local") {
          if (!ctx.config.plugins.allowLocal)
            throw new PluginProblem(
              "E_PLUGIN_LOCAL_DISABLED",
              "local plugin installs are off (FLOWAID_PLUGIN_ALLOW_LOCAL)",
            );
          if (!b.path) throw new BadRequestError("source local needs path");
          if (!isAllowed(b.packageName, ctx.config.plugins.allowList))
            throw new PluginProblem(
              "E_PLUGIN_NOT_ALLOWED",
              `${b.packageName} is not on the plugin allow-list`,
            );
          resolved = await resolveLocal(b.packageName, b.path);
        } else {
          resolved = await resolvePlugin(`${b.packageName}@${b.version}`, {
            registry: registry(),
            allowList: ctx.config.plugins.allowList,
            ...(b.integrity ? { expectedIntegrity: b.integrity } : {}),
          });
        }
      } catch (e) {
        problemToError(e);
      }
      const row = await ctx.db.tenant(p.workspaceId, async (tx) => {
        const visible = await tx
          .select()
          .from(plugins)
          .where(or(isNull(plugins.workspaceId), eq(plugins.workspaceId, p.workspaceId)));
        if (visible.some((x) => x.packageName === resolved.name && x.source === "bundled"))
          throw new ConflictError(
            `${resolved.name} ships with this platform and cannot be installed`,
          );
        const clash = conflictingIds(visible, resolved.name, resolved.manifests);
        if (clash.length)
          throw new ConflictError(
            `node types already provided by another plugin: ${clash.join(", ")}`,
            { nodeTypes: clash },
          );
        const current = visible.find(
          (x) => x.packageName === resolved.name && x.workspaceId === p.workspaceId,
        );
        const values = {
          version: resolved.version,
          source: b.source,
          integrity: resolved.integrity,
          manifests: resolved.manifests,
          // local packages load from where they were verified; npm ones from the registry tarball
          location: b.source === "local" ? resolved.tarball : null,
          error: null,
        };
        if (current) {
          const [updated] = await tx
            .update(plugins)
            .set(values)
            .where(eq(plugins.id, current.id))
            .returning();
          return updated as PluginRow;
        }
        const [created] = await tx
          .insert(plugins)
          .values({
            id: uuidv7(),
            workspaceId: p.workspaceId,
            packageName: resolved.name,
            status: "enabled",
            pool: "general",
            ...values,
          })
          .returning();
        return created as PluginRow;
      });
      req.audit = {
        resourceId: row.id,
        details: {
          packageName: row.packageName,
          version: row.version,
          integrity: row.integrity,
          source: row.source,
        },
      };
      return reply.code(201).send({ plugin: pluginDto(row), workerRestartRequired: true });
    },
  );

  r.patch(
    "/v1/plugins/:id",
    {
      config: {
        auth: "session_or_api_key",
        scope: "admin",
        audit: { action: "plugin.update", resource: "plugin" },
        cli: { noun: "plugin", verb: "update", positional: ["id"] },
      },
      schema: {
        tags: ["plugins"],
        summary: "Enable or disable a plugin, or move it to another worker pool",
        params: IdParams,
        body: z
          .object({
            status: z.enum(["enabled", "disabled"]).optional(),
            pool: WorkerPoolSchema.optional(),
          })
          .refine((x) => x.status !== undefined || x.pool !== undefined, "send status or pool"),
        response: { 200: InstalledSchema },
      },
    },
    async (req) => {
      const p = need(req.principal);
      const row = await ctx.db.tenant(p.workspaceId, async (tx) => {
        const cur = await visiblePlugin(tx, p.workspaceId, req.params.id);
        if (cur.workspaceId === null) {
          // global rows affect every workspace on the platform
          if (req.body.pool !== undefined)
            throw new BadRequestError("bundled plugins accept only status changes");
          if (!roleAtLeast(p.role, "owner"))
            throw new ForbiddenError("only an owner can enable or disable a bundled plugin");
        }
        const set = {
          ...(req.body.status ? { status: req.body.status } : {}),
          ...(req.body.pool ? { pool: req.body.pool } : {}),
        };
        const run = async (t: Tx) => {
          const [u] = await t.update(plugins).set(set).where(eq(plugins.id, cur.id)).returning();
          return u as PluginRow;
        };
        return cur.workspaceId === null ? ctx.db.system(run) : run(tx);
      });
      req.audit = { resourceId: row.id, details: { packageName: row.packageName, ...req.body } };
      return { plugin: pluginDto(row), workerRestartRequired: true };
    },
  );

  r.delete(
    "/v1/plugins/:id",
    {
      config: {
        auth: "session_or_api_key",
        scope: "admin",
        audit: { action: "plugin.uninstall", resource: "plugin" },
        cli: { noun: "plugin", verb: "remove", positional: ["id"] },
      },
      schema: { tags: ["plugins"], params: IdParams, response: { 204: NoContent } },
    },
    async (req, reply) => {
      const p = need(req.principal);
      const row = await ctx.db.tenant(p.workspaceId, async (tx) => {
        const cur = await visiblePlugin(tx, p.workspaceId, req.params.id);
        if (cur.workspaceId === null)
          throw new ConflictError("bundled plugins cannot be removed; disable them instead");
        await tx.delete(plugins).where(eq(plugins.id, cur.id));
        return cur;
      });
      req.audit = {
        resourceId: row.id,
        details: { packageName: row.packageName, version: row.version },
      };
      return reply.code(204).send(null);
    },
  );
}
