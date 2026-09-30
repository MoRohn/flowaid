/**
 * Catalog responses (API.md §3.2). Top-level fields are pinned; nested JSON Schema documents stay
 * `unknown`, and `.loose()` keeps fields a newer node, tool or model adds instead of stripping them.
 */
import { z } from "zod";

const Json = z.unknown();

export const NodeManifestDtoSchema = z
  .object({
    id: z.string(),
    version: z.string(),
    metadata: z.object({ name: z.string(), description: z.string(), category: z.string() }).loose(),
    configSchema: Json,
    inputs: z.array(Json),
    outputs: z.array(Json),
    controlPorts: z.array(Json),
    credentials: z.array(Json),
    capabilities: z.array(z.string()),
  })
  .loose();

export const ToolDefinitionDtoSchema = z
  .object({
    name: z.string(),
    description: z.string(),
    inputSchema: Json,
    outputSchema: Json.optional(),
    approvalRequired: z.boolean(),
    source: z.object({ kind: z.enum(["mcp", "openapi", "workflow", "builtin", "http"]) }).loose(),
  })
  .loose();

export const ToolDtoSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  kind: z.enum(["openapi", "workflow", "code", "http"]),
  definitions: z.array(ToolDefinitionDtoSchema),
  source: z.record(z.string(), Json),
  credentialId: z.string().nullable(),
  version: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const WorkflowSignatureSchema = z.object({
  versionId: z.uuid(),
  inputs: Json,
  outputs: Json,
  references: z.array(z.uuid()),
});

export const ModelDtoSchema = z.object({
  provider: z.string(),
  model: z.string(),
  aliases: z.array(z.string()).optional(),
  kind: z.enum(["decision", "chat", "embedding", "rerank"]),
  contextTokens: z.number().optional(),
  maxOutputTokens: z.number().optional(),
  pricing: Json.optional(),
  deprecated: z.string().optional(),
  capabilities: z.record(z.string(), z.boolean()),
  longContext: Json.optional(),
  limits: Json.optional(),
});

export const ProviderDtoSchema = z.object({
  id: z.string(),
  models: z.number(),
  configuredOnServer: z.boolean(),
});
