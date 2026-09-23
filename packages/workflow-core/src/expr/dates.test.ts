/**
 * `format_date` parsing is independent of the process time zone: this file
 * runs in both Vitest projects (`node` under the machine's zone and
 * `tz-new-york` under `TZ=America/New_York`, see `vitest.config.ts` and
 * `pnpm test:tz`) with identical expectations.
 */
import { describe, expect, inject, it } from "vitest";
import type { ExprAst } from "../bindings.js";
import { ExpressionError } from "../errors.js";
import type { JsonValue } from "../json.js";
import {
  ACCEPTED_DATE_FORMS,
  evaluateExpression,
  expressionErrorReason,
  toDate,
  type ExpressionErrorReason,
} from "./evaluator.js";
import { parseExpression } from "./parser.js";
import { createEvalScope } from "./scope.js";

declare module "vitest" {
  export interface ProvidedContext {
    /** Set by the `tz-new-york` project so the file can prove it really runs in that zone. */
    expectedTimeZone?: string;
  }
}

const expectedZone = inject("expectedTimeZone");

const scope = createEvalScope({
  ports: {
    d: {
      iso: "2026-03-04T05:06:07.089Z",
      epoch: 1_700_000_000_000,
      local: "2024-01-02T00:00",
      us: "1/2/2024",
    },
  },
  now: () => "2026-01-02T03:04:05.000Z",
});

function ast(source: string): ExprAst {
  const r = parseExpression(source);
  if (!r.ok) throw new Error(`parse failed for '${source}': ${r.message} at ${r.offset}`);
  return r.ast;
}
function run(source: string): JsonValue {
  return evaluateExpression(ast(source), scope);
}
function failure(source: string): ExpressionError {
  try {
    run(source);
  } catch (error) {
    if (error instanceof ExpressionError) return error;
    throw error;
  }
  throw new Error(`expected '${source}' to throw`);
}

describe("format_date: time zone", () => {
  it("knows which zone it runs in", () => {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    expect(typeof zone).toBe("string");
    if (expectedZone !== undefined) {
      expect(zone).toBe(expectedZone);
      expect(new Date(Date.UTC(2024, 0, 15)).getTimezoneOffset()).toBe(300);
      // The hazard the accepted forms close: an offset-less string is local time to `new Date`.
      expect(new Date("2024-01-02T00:00").getUTCHours()).toBe(5);
    }
  });

  it("never consults the process zone", () => {
    expect(run("format_date('2024-01-02T00:00:00Z', 'HH')")).toBe("00");
    expect(run("format_date('2024-01-02', 'HH')")).toBe("00");
    expect(run("format_date(d.epoch, 'HH:mm')")).toBe("22:13");
    expect(expressionErrorReason(failure('format_date(d.local, "HH")'))).toBe("INVALID_DATE");
    expect(expressionErrorReason(failure("format_date(d.us)"))).toBe("INVALID_DATE");
  });
});

describe("format_date: accepted forms", () => {
  it.each<[string, string]>([
    ["format_date(0)", "1970-01-01T00:00:00.000Z"],
    ["format_date(1000)", "1970-01-01T00:00:01.000Z"],
    ["format_date(-1)", "1969-12-31T23:59:59.999Z"],
    ["format_date(1.5)", "1970-01-01T00:00:00.001Z"],
    ["format_date(1700000000000, 'YYYY-MM-DD HH:mm:ss')", "2023-11-14 22:13:20"],
    ["format_date(d.epoch, 'YYYY')", "2023"],
    ["format_date(8.64e15, 'YYYY')", "275760"],
    ["format_date('2024-01-02')", "2024-01-02T00:00:00.000Z"],
    ["format_date('2024-02-29')", "2024-02-29T00:00:00.000Z"],
    ["format_date('0001-01-01', 'YYYY-MM-DD')", "0001-01-01"],
    ["format_date('9999-12-31')", "9999-12-31T00:00:00.000Z"],
    ["format_date('2024-01-02T03:04:05Z')", "2024-01-02T03:04:05.000Z"],
    ["format_date('2024-01-02t03:04:05z')", "2024-01-02T03:04:05.000Z"],
    ["format_date('2024-01-02T03:04:05.678Z')", "2024-01-02T03:04:05.678Z"],
    ["format_date('2024-01-02T03:04:05.6789Z')", "2024-01-02T03:04:05.678Z"],
    ["format_date('2024-01-02T03:04:05.1Z')", "2024-01-02T03:04:05.100Z"],
    ["format_date('2024-01-02T03:04:05.000000001Z')", "2024-01-02T03:04:05.000Z"],
    ["format_date('2024-01-02T03:04:05+00:00')", "2024-01-02T03:04:05.000Z"],
    ["format_date('2024-01-02T03:04:05-00:00')", "2024-01-02T03:04:05.000Z"],
    ["format_date('2024-01-02T03:04:05+02:00')", "2024-01-02T01:04:05.000Z"],
    ["format_date('2024-01-02T03:04:05-05:30')", "2024-01-02T08:34:05.000Z"],
    ["format_date('2024-01-01T00:00:00+14:00')", "2023-12-31T10:00:00.000Z"],
    ["format_date('2024-12-31T23:30:00-01:00')", "2025-01-01T00:30:00.000Z"],
    ["format_date('2024-03-10T06:30:00Z', 'HH:mm')", "06:30"],
    ["format_date('2024-11-03T06:30:00Z', 'HH:mm')", "06:30"],
    ["format_date('0001-01-01T00:00:00Z', 'YYYY')", "0001"],
    ["format_date('9999-12-31T23:59:59.999Z')", "9999-12-31T23:59:59.999Z"],
    ["format_date(d.iso, 'DD/MM/YYYY [at] HH[h]')", "04/03/2026 at 05h"],
    ["format_date(now(), 'YYYY-MM-DD')", "2026-01-02"],
  ])("%s → %j", (source, expected) => {
    expect(run(source)).toBe(expected);
  });

  it("parses epoch milliseconds, YYYY-MM-DD and RFC 3339 through toDate", () => {
    expect(toDate(0).toISOString()).toBe("1970-01-01T00:00:00.000Z");
    expect(toDate("2024-01-02").toISOString()).toBe("2024-01-02T00:00:00.000Z");
    expect(toDate("2024-01-02T03:04:05+02:00").toISOString()).toBe("2024-01-02T01:04:05.000Z");
    expect(ACCEPTED_DATE_FORMS).toHaveLength(3);
  });
});

describe("format_date: rejected forms", () => {
  it.each<[string, ExpressionErrorReason]>([
    ["format_date('2024-01-02T00:00')", "INVALID_DATE"],
    ["format_date('2024-01-02T00:00:00')", "INVALID_DATE"],
    ["format_date('2024-01-02T00:00:00.000')", "INVALID_DATE"],
    ["format_date('2024-01-02 00:00:00Z')", "INVALID_DATE"],
    ["format_date('2024-01-02T00:00:00 Z')", "INVALID_DATE"],
    ["format_date('2024-01-02T03:04:05+0200')", "INVALID_DATE"],
    ["format_date('2024-01-02T03:04:05+02')", "INVALID_DATE"],
    ["format_date('2024-01-02T03:04:05+24:00')", "INVALID_DATE"],
    ["format_date('2024-01-02T03:04:05+02:60')", "INVALID_DATE"],
    ["format_date('2024-01-02T03:04:05.Z')", "INVALID_DATE"],
    ["format_date('2024-01-02T24:00:00Z')", "INVALID_DATE"],
    ["format_date('2024-01-02T23:60:00Z')", "INVALID_DATE"],
    ["format_date('2024-01-02T23:59:60Z')", "INVALID_DATE"],
    ["format_date('2024-13-01')", "INVALID_DATE"],
    ["format_date('2024-00-01')", "INVALID_DATE"],
    ["format_date('2024-01-00')", "INVALID_DATE"],
    ["format_date('2024-02-30')", "INVALID_DATE"],
    ["format_date('2023-02-29')", "INVALID_DATE"],
    ["format_date('2024-04-31')", "INVALID_DATE"],
    ["format_date('2024-1-2')", "INVALID_DATE"],
    ["format_date('24-01-02')", "INVALID_DATE"],
    ["format_date('20240102')", "INVALID_DATE"],
    ["format_date('1/2/2024')", "INVALID_DATE"],
    ["format_date('January 2, 2024')", "INVALID_DATE"],
    ["format_date('Tue, 02 Jan 2024 00:00:00 GMT')", "INVALID_DATE"],
    ["format_date('1700000000000')", "INVALID_DATE"],
    ["format_date(' 2024-01-02')", "INVALID_DATE"],
    ["format_date('2024-01-02T03:04:05Z ')", "INVALID_DATE"],
    ["format_date('')", "INVALID_DATE"],
    ["format_date('now')", "INVALID_DATE"],
    ["format_date('not a date')", "INVALID_DATE"],
    ["format_date(1e20)", "INVALID_DATE"],
    ["format_date(-1e20)", "INVALID_DATE"],
    ["format_date(8.64e15 + 1)", "INVALID_DATE"],
    ["format_date(null)", "TYPE"],
    ["format_date(true)", "TYPE"],
    ["format_date([])", "TYPE"],
    ["format_date({})", "TYPE"],
    ["format_date(d.iso, 1)", "TYPE"],
  ])("%s → %s", (source, reason) => {
    expect(expressionErrorReason(failure(source))).toBe(reason);
  });

  it("names the accepted forms in the error", () => {
    const error = failure("format_date('1/2/2024')");
    expect(error.message).toContain('"1/2/2024"');
    for (const form of ACCEPTED_DATE_FORMS) expect(error.message).toContain(form);
    expect(error.details).toMatchObject({
      reason: "INVALID_DATE",
      accepted: [...ACCEPTED_DATE_FORMS],
    });
  });
});
