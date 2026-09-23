/** JSON Schema validation (draft 2020-12, ajv — the engine the compiler uses) with a small compile cache. */
import Ajv2020Module from "ajv/dist/2020.js";
import { stableStringify } from "@flowaid/shared";
import type { JsonSchema, JsonValue } from "@flowaid/workflow-core";

const Ajv2020 = Ajv2020Module.default;
const ajv = new Ajv2020({ strict: false, allErrors: true, validateFormats: false });
const cache = new Map<string, ReturnType<typeof ajv.compile>>();

export interface SchemaIssue {
  path: string;
  message: string;
}

export function validateJson(
  schema: JsonSchema,
  value: JsonValue | undefined,
): { ok: true } | { ok: false; errors: SchemaIssue[] } {
  const key = stableStringify(schema);
  let fn = cache.get(key);
  if (!fn) {
    fn = ajv.compile(schema as object);
    if (cache.size >= 200) cache.delete(cache.keys().next().value as string);
    cache.set(key, fn);
  }
  if (fn(value)) return { ok: true };
  return {
    ok: false,
    errors: (fn.errors ?? []).map((e) => ({
      path: e.instancePath,
      message: e.message ?? e.keyword,
    })),
  };
}
