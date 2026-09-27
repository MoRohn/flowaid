import { z } from "zod";
import { defineNode, ok } from "@flowaid/node-sdk";
import { ConflictError, type JsonValue } from "@flowaid/workflow-core";
import { casUpdate, readVersioned } from "./cas.js";
import { stateNamespace } from "./get.js";

export const checkpointNode = defineNode({
  id: "flowaid.state.checkpoint",
  version: "1.0.0",
  metadata: {
    name: "Checkpoint",
    description:
      "Saves a named snapshot of a value with a version number, or loads the latest one. A save can require the version it read (compare-and-set), so concurrent writers never overwrite each other silently.",
    category: "state",
    icon: "save",
    tags: ["state", "checkpoint", "snapshot"],
    summary: "{{ config.op }} {{ config.name }}",
  },
  configSchema: z.strictObject({
    op: z
      .enum(["save", "load"])
      .default("save")
      .meta({ "x-ui": { widget: "select" } }),
    name: z.string().regex(/^[a-z][a-z0-9_.-]{0,63}$/),
    namespace: stateNamespace,
  }),
  inputSchema: z.object({
    value: z.unknown().optional(),
    expected_version: z
      .int()
      .min(0)
      .optional()
      .meta({
        "x-port": {
          description:
            "Save only if the checkpoint is still at this version (0 = does not exist yet).",
        },
      }),
  }),
  outputSchema: z.object({
    value: z.unknown(),
    version: z.int().min(0),
    found: z.boolean(),
    saved_at: z.string().nullable(),
  }),
  capabilities: ["state"],
  // an omitted op is the default `save`
  idempotency: { byConfig: "/op", cases: { save: "keyed", load: "safe" }, default: "keyed" },
  defaultPolicy: { timeoutMs: 10000 },
  execute: async (ctx, input) => {
    const key = `checkpoint:${ctx.config.name}`;
    const ns = ctx.config.namespace;
    const view = (v: ReturnType<typeof readVersioned>) => {
      const d = v?.data && typeof v.data === "object" && !Array.isArray(v.data) ? v.data : null;
      return {
        value: d?.value ?? null,
        version: v?.version ?? 0,
        found: v !== null,
        saved_at: typeof d?.savedAt === "string" ? d.savedAt : null,
      };
    };
    if (ctx.config.op === "load") return ok(view(readVersioned(await ctx.state.get(ns, key))));
    const idem = ctx.node.idempotencyKey;
    const savedAt = ctx.clock.now().toISOString();
    const { value } = await casUpdate(ctx, ns, key, (current) => {
      const d =
        current?.data && typeof current.data === "object" && !Array.isArray(current.data)
          ? current.data
          : null;
      // a retry of the same save keeps the version it produced
      if (idem && d?.key === idem) return undefined;
      const version = current?.version ?? 0;
      if (input.expected_version !== undefined && input.expected_version !== version)
        throw new ConflictError(
          `checkpoint ${ctx.config.name} is at version ${version}, expected ${input.expected_version}`,
        );
      return { value: (input.value ?? null) as JsonValue, savedAt, ...(idem ? { key: idem } : {}) };
    });
    return ok(view(value));
  },
});
