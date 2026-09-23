import { z } from "zod";
import { defineNode, ok } from "@flowaid/node-sdk";
import { SchemaValidationError, getPointer, type JsonValue } from "@flowaid/workflow-core";

export const extractNode = defineNode({
  id: "flowaid.data.extract",
  version: "1.0.0",
  metadata: {
    name: "Extract",
    description:
      "Pulls named fields out of a value with JSON Pointers, and named groups out of text with a regular expression. Missing fields are null (or fail with `required`).",
    category: "data",
    icon: "pickaxe",
    tags: ["data", "extract", "regex"],
    summary: "extract fields",
  },
  configSchema: z.strictObject({
    fields: z
      .record(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,63}$/), z.string().regex(/^(\/.*)?$/))
      .default({})
      .meta({
        "x-ui": {
          widget: "keyvalue",
          help: "Output field → JSON Pointer into `value` (e.g. /customer/email).",
        },
      }),
    pattern: z
      .string()
      .max(1000)
      .optional()
      .meta({
        "x-ui": {
          help: "Regular expression applied to text `value`; its named groups become fields.",
        },
      }),
    flags: z
      .string()
      .regex(/^[imsu]*$/)
      .default(""),
    all: z
      .boolean()
      .default(false)
      .meta({
        "x-ui": { widget: "switch", help: "Collect every match as a list under `matches`." },
      }),
    required: z
      .boolean()
      .default(false)
      .meta({ "x-ui": { widget: "switch", help: "Fail when a field is missing." } }),
  }),
  inputSchema: z.object({ value: z.unknown() }),
  outputSchema: z.object({
    fields: z.record(z.string(), z.unknown()),
    matches: z.array(z.record(z.string(), z.string())),
  }),
  capabilities: [],
  idempotency: "safe",
  defaultPolicy: { timeoutMs: 10000 },
  execute: (ctx, input) => {
    const value = (input.value ?? null) as JsonValue;
    const fields: Record<string, JsonValue> = {};
    const missing: string[] = [];
    for (const [name, pointer] of Object.entries(ctx.config.fields)) {
      const v = getPointer(value, pointer);
      if (v === undefined) missing.push(name);
      fields[name] = v ?? null;
    }
    const matches: Record<string, string>[] = [];
    if (ctx.config.pattern !== undefined) {
      const text = typeof value === "string" ? value : JSON.stringify(value);
      const re = new RegExp(ctx.config.pattern, `${ctx.config.flags}g`);
      for (const m of text.matchAll(re)) {
        matches.push({
          ...Object.fromEntries(Object.entries(m.groups ?? {}).map(([k, v]) => [k, v ?? ""])),
          $0: m[0],
        });
        if (!ctx.config.all) break;
      }
      const first = matches[0];
      for (const [k, v] of Object.entries(first ?? {})) if (k !== "$0") fields[k] = v;
      if (!first)
        for (const name of re.source.matchAll(/\(\?<([A-Za-z_][A-Za-z0-9_]*)>/g))
          if (name[1]) {
            fields[name[1]] = null;
            missing.push(name[1]);
          }
    }
    if (ctx.config.required && missing.length > 0)
      throw new SchemaValidationError(
        `missing field${missing.length === 1 ? "" : "s"}: ${missing.join(", ")}`,
        missing.map((m) => ({ path: `/${m}`, message: "not found" })),
      );
    return Promise.resolve(ok({ fields, matches }));
  },
});
