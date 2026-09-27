/** Output matchers (`equals`, `contains`, `regex`, `schema`, `range`); `judge` lives in judge.ts. */
import Ajv2020Module from "ajv/dist/2020.js";
import { stableStringify } from "@flowaid/shared";
import {
  MAX_REGEX_SUBJECT_LENGTH,
  checkRegexLiteral,
  getDefaultRegexEngine,
  type JsonValue,
} from "@flowaid/workflow-core";
import type { Matcher } from "../expectation.js";

const Ajv2020 = Ajv2020Module.default;
const ajv = new Ajv2020({ strict: false, allErrors: true, validateFormats: false });

export interface MatchOutcome {
  passed: boolean;
  message?: string;
}

/** Key-order-independent deep equality; `1` and `1.0` are equal, `"1"` and `1` are not. */
export function jsonEquals(a: JsonValue | undefined, b: JsonValue | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  return stableStringify(a) === stableStringify(b);
}

function asText(v: JsonValue | undefined): string {
  return typeof v === "string" ? v : v === undefined ? "" : JSON.stringify(v);
}

export function matchValue(
  matcher: Exclude<Matcher, { type: "judge" }>,
  actual: JsonValue | undefined,
): MatchOutcome {
  switch (matcher.type) {
    case "equals":
      return jsonEquals(actual, matcher.value)
        ? { passed: true }
        : {
            passed: false,
            message: `expected ${asText(matcher.value)}, got ${asText(actual) || "nothing"}`,
          };
    case "contains": {
      const needle = matcher.value;
      const hit = Array.isArray(actual)
        ? actual.some((x) => (typeof x === "string" ? x.includes(needle) : jsonEquals(x, needle)))
        : asText(actual).includes(needle);
      return hit
        ? { passed: true }
        : { passed: false, message: `does not contain ${JSON.stringify(needle)}` };
    }
    case "regex": {
      const check = checkRegexLiteral(matcher.pattern, "");
      if (!check.ok) return { passed: false, message: `invalid pattern: ${check.message}` };
      const subject = asText(actual);
      if (subject.length > MAX_REGEX_SUBJECT_LENGTH)
        return {
          passed: false,
          message: `value longer than ${MAX_REGEX_SUBJECT_LENGTH} characters`,
        };
      return getDefaultRegexEngine().compile(matcher.pattern, "").test(subject)
        ? { passed: true }
        : { passed: false, message: `does not match /${matcher.pattern}/` };
    }
    case "schema": {
      let validate;
      try {
        validate = ajv.compile(matcher.schema as object);
      } catch (error) {
        return {
          passed: false,
          message: `invalid schema: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
      if (validate(actual === undefined ? null : actual)) return { passed: true };
      return {
        passed: false,
        message: (validate.errors ?? [])
          .map((e) => `${e.instancePath || "/"} ${e.message ?? e.keyword}`)
          .join("; "),
      };
    }
    case "range": {
      if (typeof actual !== "number")
        return { passed: false, message: `expected a number, got ${asText(actual) || "nothing"}` };
      if (matcher.min !== undefined && actual < matcher.min)
        return { passed: false, message: `${actual} < ${matcher.min}` };
      if (matcher.max !== undefined && actual > matcher.max)
        return { passed: false, message: `${actual} > ${matcher.max}` };
      return { passed: true };
    }
  }
}
