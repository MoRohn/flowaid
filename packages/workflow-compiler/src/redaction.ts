/**
 * Write-time redaction rules (ARCHITECTURE.md §10.6): `x-dataClass: pii` is masked and
 * `sensitive` hashed wherever the value is persisted, as node input (`/in/…`) or output
 * (`/out/…`). A template or expression that reads a classified value is redacted as a whole.
 * Node privacy flags widen this: `containsPII` masks all input and output, `sensitive` hashes
 * it, `redactFields` masks the listed pointers and `doNotPersist` drops the output.
 *
 * Pointers use `*` for "every array item"; the runtime Redactor expands it.
 */
import {
  escapePointerToken,
  type CompiledBinding,
  type DataClass,
  type JsonSchema,
  type RedactionRule,
  type ResolvedNodePolicy,
} from "@flowaid/workflow-core";
import type { NodeInfo } from "./context.js";
import { isPlainObject } from "./util.js";

const MAX_DEPTH = 8;
const RANK: Record<DataClass, number> = { public: 0, internal: 1, sensitive: 2, pii: 3 };

function modeFor(dataClass: DataClass): RedactionRule["mode"] | null {
  if (dataClass === "pii") return "mask";
  if (dataClass === "sensitive") return "hash";
  return null;
}

function classOf(schema: JsonSchema): DataClass | null {
  const value = (schema as { "x-dataClass"?: unknown })["x-dataClass"];
  return value === "pii" || value === "sensitive" || value === "internal" || value === "public"
    ? value
    : null;
}

/** Pointers under `base` whose schema carries a redacting data class (outermost wins). */
export function classifiedPointers(
  schema: JsonSchema,
  base: string,
  depth = 0,
): { pointer: string; dataClass: DataClass }[] {
  const own = classOf(schema);
  if (own && modeFor(own)) return [{ pointer: base, dataClass: own }];
  if (depth >= MAX_DEPTH) return [];
  const out: { pointer: string; dataClass: DataClass }[] = [];
  if (isPlainObject(schema.properties)) {
    for (const [key, sub] of Object.entries(schema.properties)) {
      if (isPlainObject(sub))
        out.push(...classifiedPointers(sub, `${base}/${escapePointerToken(key)}`, depth + 1));
    }
  }
  if (isPlainObject(schema.items))
    out.push(...classifiedPointers(schema.items, `${base}/*`, depth + 1));
  for (const key of ["anyOf", "oneOf", "allOf"] as const) {
    const alternatives = schema[key];
    if (Array.isArray(alternatives)) {
      for (const alt of alternatives) {
        if (isPlainObject(alt)) out.push(...classifiedPointers(alt, base, depth + 1));
      }
    }
  }
  return out;
}

/** The strongest redacting class among the values a template or expression reads. */
function strongestSourceClass(info: NodeInfo, bindingPath: string): DataClass | null {
  let best: DataClass | null = null;
  for (const dep of info.dataIn) {
    if (dep.bindingPath !== bindingPath || !dep.sourceSchema) continue;
    for (const { dataClass } of classifiedPointers(dep.sourceSchema, "")) {
      if (best === null || RANK[dataClass] > RANK[best]) best = dataClass;
    }
  }
  return best;
}

function bindingRules(
  info: NodeInfo,
  binding: CompiledBinding,
  pointer: string,
  bindingPath: string,
): { pointer: string; dataClass: DataClass }[] {
  switch (binding.kind) {
    case "template":
    case "expr": {
      const dataClass = strongestSourceClass(info, bindingPath);
      return dataClass && modeFor(dataClass) ? [{ pointer, dataClass }] : [];
    }
    case "object": {
      const out: { pointer: string; dataClass: DataClass }[] = [];
      for (const [key, field] of Object.entries(binding.fields)) {
        const token = escapePointerToken(key);
        out.push(...bindingRules(info, field, `${pointer}/${token}`, `${bindingPath}/${token}`));
      }
      return out;
    }
    case "array": {
      const out: { pointer: string; dataClass: DataClass }[] = [];
      binding.items.forEach((item, i) =>
        out.push(...bindingRules(info, item, `${pointer}/${i}`, `${bindingPath}/${i}`)),
      );
      return out;
    }
    case "ref":
    case "literal":
      return classifiedPointers(binding.schema, pointer);
  }
}

/** Compiled data-in bindings of a node as (persisted pointer, binding path, binding). */
function persistedInputs(
  info: NodeInfo,
): { pointer: string; bindingPath: string; binding: CompiledBinding }[] {
  const out: { pointer: string; bindingPath: string; binding: CompiledBinding }[] = [];
  for (const [key, binding] of info.compiled) {
    if (
      key.startsWith("when/") ||
      key.startsWith("next/") ||
      key.startsWith("result/") ||
      key === "exitWhen" ||
      key === "reduce" ||
      key === "collect"
    ) {
      continue;
    }
    if (key.startsWith("context/")) {
      const name = key.slice("context/".length);
      out.push({
        pointer: `/in/context/${escapePointerToken(name)}`,
        bindingPath: `/context/${escapePointerToken(name)}`,
        binding,
      });
      continue;
    }
    const token = escapePointerToken(key);
    const bindingPath =
      info.node.kind === "human" && key === "value"
        ? "/mode/value"
        : info.node.kind === "wait"
          ? "/until/at"
          : `/${token}`;
    out.push({ pointer: `/in/${token}`, bindingPath, binding });
  }
  return out;
}

export function redactionRules(info: NodeInfo, policy: ResolvedNodePolicy): RedactionRule[] {
  const found: { pointer: string; dataClass: DataClass }[] = [];
  for (const { pointer, bindingPath, binding } of persistedInputs(info)) {
    found.push(...bindingRules(info, binding, pointer, bindingPath));
  }
  for (const [port, schema] of info.outputs) {
    const declared = info.manifest?.outputs.find((o) => o.name === port)?.dataClass;
    const pointer = `/out/${escapePointerToken(port)}`;
    if (declared && modeFor(declared)) found.push({ pointer, dataClass: declared });
    else found.push(...classifiedPointers(schema, pointer));
  }
  if (policy.privacy.containsPII) {
    found.push({ pointer: "/in", dataClass: "pii" }, { pointer: "/out", dataClass: "pii" });
  }
  if (policy.privacy.sensitive) {
    found.push(
      { pointer: "/in", dataClass: "sensitive" },
      { pointer: "/out", dataClass: "sensitive" },
    );
  }

  // One rule per pointer, strongest class first seen wins.
  const byPointer = new Map<string, DataClass>();
  for (const { pointer, dataClass } of found) {
    const existing = byPointer.get(pointer);
    if (!existing || RANK[dataClass] > RANK[existing]) byPointer.set(pointer, dataClass);
  }
  const rules: RedactionRule[] = [];
  for (const [pointer, dataClass] of byPointer) {
    const mode = modeFor(dataClass);
    if (mode) rules.push({ pointer, dataClass, mode });
  }
  for (const pointer of policy.privacy.redactFields) {
    if (!rules.some((r) => r.pointer === pointer))
      rules.push({ pointer, dataClass: "sensitive", mode: "mask" });
  }
  if (policy.privacy.doNotPersist)
    rules.push({ pointer: "/out", dataClass: "sensitive", mode: "drop" });
  return rules;
}
