/**
 * `inputIssues`: a run input checked against a version's `inputs` schema (JSON Schema 2020-12,
 * formats not enforced), as every way of starting a run checks it: `POST …/run`, schedule
 * triggers at deploy and at fire time. Empty when the input is valid.
 */
import Ajv2020Module from "ajv/dist/2020.js";
import type { ValidateFunction } from "ajv/dist/2020.js";
import type { JsonSchema, JsonValue } from "@flowaid/workflow-core";

const Ajv2020 = Ajv2020Module.default;
const ajv = new Ajv2020({ strict: false, allErrors: true, validateFormats: false });

// a type alias (not an interface) so issues are JSON values for error details
export type InputIssue = {
  /** JSON pointer into the input ("/" for the whole input) */
  path: string;
  message: string;
};

// Schemas usually arrive as fresh objects (read from the database); Ajv caches compiled schemas
// by object, so compile once per distinct schema text and keep the cache bounded.
const MAX_CACHED = 200;
const compiled = new Map<string, { schema: object; validate: ValidateFunction }>();

function validatorFor(schema: JsonSchema): ValidateFunction {
  const key = JSON.stringify(schema);
  const hit = compiled.get(key);
  if (hit) {
    compiled.delete(key);
    compiled.set(key, hit);
    return hit.validate;
  }
  const own = JSON.parse(key) as object;
  const validate = ajv.compile(own);
  compiled.set(key, { schema: own, validate });
  if (compiled.size > MAX_CACHED) {
    const [oldest] = compiled;
    if (oldest) {
      compiled.delete(oldest[0]);
      ajv.removeSchema(oldest[1].schema);
    }
  }
  return validate;
}

export function inputIssues(schema: JsonSchema, input: JsonValue | undefined): InputIssue[] {
  const validate = validatorFor(schema);
  if (validate(input)) return [];
  return (validate.errors ?? []).map((e) => ({
    path: e.instancePath || "/",
    message: e.message ?? e.keyword,
  }));
}

/** One line for an error message: `/name must have required property 'name'; …`. */
export function describeInputIssues(issues: readonly InputIssue[], max = 3): string {
  const shown = issues.slice(0, max).map((i) => `${i.path} ${i.message}`);
  const more = issues.length > max ? `; and ${issues.length - max} more` : "";
  return `${shown.join("; ")}${more}`;
}
