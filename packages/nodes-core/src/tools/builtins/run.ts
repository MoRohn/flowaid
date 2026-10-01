/**
 * The builtin agent tools at run time. Each answers with a short JSON result for the model, or a
 * failed result whose message says what to change; nothing here throws for a bad argument, so the
 * agent can correct itself. `web_fetch` goes through the worker's SafeFetch (private networks,
 * redirects and size are limited there) and reads only text.
 */
import { htmlTitle, htmlToMarkdown } from "@flowaid/knowledge";
import type { JsonValue, SafeFetch, ToolResult } from "@flowaid/workflow-core";
import {
  CALCULATOR_TOOL,
  CURRENT_TIME_TOOL,
  WEB_FETCH_DEFAULT_CHARS,
  WEB_FETCH_MAX_CHARS,
  WEB_FETCH_TOOL,
} from "./definitions.js";

export interface BuiltinToolDeps {
  /** the worker's guarded fetch */
  fetch: SafeFetch;
  signal: AbortSignal;
  /** web_fetch's own limit, within the call's */
  timeoutMs?: number;
  now?: () => Date;
}

const WEB_FETCH_TIMEOUT_MS = 15_000;
const WEB_FETCH_MAX_BYTES = 2_000_000;

// ── results ───────────────────────────────────────────────────────────────────────────────────

function ok(structured: Record<string, JsonValue>, started: number): ToolResult {
  return {
    ok: true,
    content: JSON.stringify(structured),
    structured,
    latencyMs: Math.max(0, Date.now() - started),
  };
}

function failed(message: string, started: number, retryable = false): ToolResult {
  return {
    ok: false,
    content: message,
    error: { code: "TOOL_EXECUTION_ERROR", message, retryable },
    latencyMs: Math.max(0, Date.now() - started),
  };
}

const argsObject = (args: JsonValue): Record<string, JsonValue> =>
  typeof args === "object" && args !== null && !Array.isArray(args) ? args : {};

// ── calculator ────────────────────────────────────────────────────────────────────────────────

type Token =
  { kind: "num"; value: number } | { kind: "id"; value: string } | { kind: "op"; value: string };

function tokenize(src: string): Token[] {
  const out: Token[] = [];
  // the multiplication and division signs people paste, and ** for powers
  const s = src.replace(/[×·]/g, "*").replace(/÷/g, "/").replace(/\*\*/g, "^").replace(/−/g, "-");
  let i = 0;
  while (i < s.length) {
    const c = s[i] ?? "";
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    const num = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i.exec(s.slice(i));
    if (num) {
      out.push({ kind: "num", value: Number(num[0]) });
      i += num[0].length;
      continue;
    }
    const id = /^[a-z_][a-z0-9_]*/i.exec(s.slice(i));
    if (id) {
      out.push({ kind: "id", value: id[0].toLowerCase() });
      i += id[0].length;
      continue;
    }
    if ("+-*/%^(),".includes(c)) {
      out.push({ kind: "op", value: c });
      i++;
      continue;
    }
    throw new Error(`the character '${c}' is not part of arithmetic`);
  }
  return out;
}

const CONSTANTS: Record<string, number> = { pi: Math.PI, e: Math.E };

function roundTo(x: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round((x + Math.sign(x) * Number.EPSILON) * f) / f;
}

const FUNCTIONS: Record<string, { arity: [number, number]; fn: (...a: number[]) => number }> = {
  sqrt: { arity: [1, 1], fn: Math.sqrt },
  abs: { arity: [1, 1], fn: Math.abs },
  round: { arity: [1, 2], fn: (x = 0, d = 0) => roundTo(x, Math.trunc(d)) },
  floor: { arity: [1, 1], fn: Math.floor },
  ceil: { arity: [1, 1], fn: Math.ceil },
  min: { arity: [1, 50], fn: Math.min },
  max: { arity: [1, 50], fn: Math.max },
  pow: { arity: [2, 2], fn: Math.pow },
  log: { arity: [1, 1], fn: Math.log10 },
  ln: { arity: [1, 1], fn: Math.log },
  exp: { arity: [1, 1], fn: Math.exp },
};

/** Evaluates arithmetic without `eval`: numbers, + - * / % ^, parentheses, a few functions. */
export function evaluateArithmetic(expression: string): number {
  const tokens = tokenize(expression);
  let pos = 0;
  let depth = 0;
  const peek = () => tokens[pos];
  const isOp = (v: string) => {
    const t = peek();
    return t?.kind === "op" && t.value === v;
  };
  const expect = (v: string) => {
    if (!isOp(v)) throw new Error(`expected '${v}'`);
    pos++;
  };

  const expr = (): number => {
    if (++depth > 100) throw new Error("the expression is nested too deeply");
    let v = term();
    while (isOp("+") || isOp("-")) {
      const op = (tokens[pos++] as { value: string }).value;
      const r = term();
      v = op === "+" ? v + r : v - r;
    }
    depth--;
    return v;
  };
  const term = (): number => {
    let v = unary();
    while (isOp("*") || isOp("/") || isOp("%")) {
      const op = (tokens[pos++] as { value: string }).value;
      const r = unary();
      if ((op === "/" || op === "%") && r === 0) throw new Error("division by zero");
      v = op === "*" ? v * r : op === "/" ? v / r : v % r;
    }
    return v;
  };
  // -2^2 is -(2^2), and 2^-1 is allowed
  const unary = (): number => {
    if (isOp("-")) {
      pos++;
      return -unary();
    }
    if (isOp("+")) {
      pos++;
      return unary();
    }
    return power();
  };
  const power = (): number => {
    const base = primary();
    if (isOp("^")) {
      pos++;
      return base ** unary();
    }
    return base;
  };
  const primary = (): number => {
    const t = peek();
    if (!t) throw new Error("the expression ends too early");
    if (t.kind === "num") {
      pos++;
      return t.value;
    }
    if (t.kind === "op" && t.value === "(") {
      pos++;
      const v = expr();
      expect(")");
      return v;
    }
    if (t.kind === "id") {
      pos++;
      if (t.value in CONSTANTS && !isOp("(")) return CONSTANTS[t.value] as number;
      const f = FUNCTIONS[t.value];
      if (!f)
        throw new Error(
          `'${t.value}' is not a known function or constant (use ${Object.keys(FUNCTIONS).join(", ")}, pi or e)`,
        );
      expect("(");
      const args: number[] = [];
      if (!isOp(")")) {
        args.push(expr());
        while (isOp(",")) {
          pos++;
          args.push(expr());
        }
      }
      expect(")");
      const [lo, hi] = f.arity;
      if (args.length < lo || args.length > hi)
        throw new Error(
          `${t.value} takes ${lo === hi ? lo : `${lo} to ${hi}`} argument${hi === 1 ? "" : "s"}`,
        );
      return f.fn(...args);
    }
    throw new Error(`unexpected '${t.value}'`);
  };

  if (tokens.length === 0) throw new Error("the expression is empty");
  const value = expr();
  if (pos < tokens.length) {
    const t = tokens[pos] as Token;
    throw new Error(`unexpected '${t.kind === "num" ? String(t.value) : t.value}'`);
  }
  if (!Number.isFinite(value)) throw new Error("the result is not a finite number");
  // 0.1 + 0.2 reads 0.3, not 0.30000000000000004
  return Number.parseFloat(value.toPrecision(15));
}

function calculator(args: JsonValue, started: number): ToolResult {
  const expression = argsObject(args).expression;
  if (typeof expression !== "string" || !expression.trim())
    return failed(
      "Give the expression to evaluate as `expression`, for example 12 * 4.5.",
      started,
    );
  if (expression.length > 500)
    return failed("The expression is longer than 500 characters; split it up.", started);
  try {
    return ok({ expression, result: evaluateArithmetic(expression) }, started);
  } catch (e) {
    return failed(
      `Could not evaluate ${JSON.stringify(expression)}: ${(e as Error).message}.`,
      started,
    );
  }
}

// ── current_time ──────────────────────────────────────────────────────────────────────────────

function currentTime(args: JsonValue, started: number, now: Date): ToolResult {
  const raw = argsObject(args).timezone;
  const timezone = typeof raw === "string" && raw.trim() ? raw.trim() : "UTC";
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      weekday: "long",
      hourCycle: "h23",
      timeZoneName: "longOffset",
    }).formatToParts(now);
  } catch {
    return failed(
      `'${timezone}' is not a time zone. Use an IANA name such as Europe/Paris or America/New_York, or leave it out for UTC.`,
      started,
    );
  }
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value;
  const date = `${part("year")}-${part("month")}-${part("day")}`;
  const time = `${part("hour")}:${part("minute")}:${part("second")}`;
  // "GMT+02:00" (or plain "GMT" for UTC) → "+02:00"
  const offset = (part("timeZoneName") ?? "GMT").replace(/^GMT/, "") || "+00:00";
  return ok(
    {
      iso: `${date}T${time}${offset === "+00:00" ? "Z" : offset}`,
      date,
      time,
      weekday: part("weekday") ?? "",
      timezone,
      utc_offset: offset,
      unix: Math.floor(now.getTime() / 1000),
    },
    started,
  );
}

// ── web_fetch ─────────────────────────────────────────────────────────────────────────────────

const TEXT_TYPES = /^(text\/|application\/(json|xml|xhtml\+xml|ld\+json|rss\+xml|atom\+xml))/i;

async function webFetch(
  args: JsonValue,
  started: number,
  deps: BuiltinToolDeps,
): Promise<ToolResult> {
  const a = argsObject(args);
  const raw = typeof a.url === "string" ? a.url.trim() : "";
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return failed("Give the page's full address as `url`, starting with https://.", started);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:")
    return failed("Only http and https addresses can be read.", started);
  const wanted = typeof a.max_characters === "number" ? Math.trunc(a.max_characters) : NaN;
  const limit = Number.isFinite(wanted)
    ? Math.min(WEB_FETCH_MAX_CHARS, Math.max(500, wanted))
    : WEB_FETCH_DEFAULT_CHARS;

  const timeout = AbortSignal.timeout(
    Math.min(deps.timeoutMs ?? WEB_FETCH_TIMEOUT_MS, WEB_FETCH_TIMEOUT_MS),
  );
  let res: Response;
  try {
    res = await deps.fetch(url.toString(), {
      method: "GET",
      headers: {
        accept: "text/html, text/plain, text/markdown, application/json;q=0.9, */*;q=0.1",
        "user-agent": "FlowAId-web_fetch/1.0 (+https://github.com/MoRohn/flowaid)",
      },
      maxRedirects: 5,
      maxBytes: WEB_FETCH_MAX_BYTES,
      signal: AbortSignal.any([deps.signal, timeout]),
    });
  } catch (e) {
    if (deps.signal.aborted) throw e;
    const message = (e as Error).message || String(e);
    return failed(
      timeout.aborted
        ? `${url.host} did not answer within ${WEB_FETCH_TIMEOUT_MS / 1000} seconds.`
        : `Could not read ${url.toString()}: ${message}`,
      started,
      timeout.aborted,
    );
  }
  const finalUrl = res.url || url.toString();
  const contentType = (res.headers.get("content-type") ?? "").split(";")[0]?.trim() ?? "";
  if (!res.ok)
    return failed(
      `${finalUrl} answered ${res.status}${res.statusText ? ` ${res.statusText}` : ""}; the page could not be read.`,
      started,
      res.status === 429 || res.status >= 500,
    );
  if (contentType && !TEXT_TYPES.test(contentType))
    return failed(
      `${finalUrl} is ${contentType}, not a text page; only HTML, text and JSON can be read.`,
      started,
    );
  let body: string;
  try {
    body = await res.text();
  } catch (e) {
    return failed(`Could not read the page body: ${(e as Error).message}`, started);
  }
  const html = /html|xml/i.test(contentType) || /^\s*<(!doctype|html)/i.test(body);
  const title = html ? htmlTitle(body) : undefined;
  const text = (html ? htmlToMarkdown(body) : body).trim();
  const truncated = text.length > limit;
  return ok(
    {
      url: finalUrl,
      status: res.status,
      content_type: contentType || "text/plain",
      ...(title ? { title } : {}),
      content: truncated ? `${text.slice(0, limit)}\n…` : text,
      truncated,
    },
    started,
  );
}

// ── dispatch ──────────────────────────────────────────────────────────────────────────────────

/** Runs one builtin agent tool; unknown ids fail with a message rather than throwing. */
export async function runBuiltinTool(
  id: string,
  args: JsonValue,
  deps: BuiltinToolDeps,
): Promise<ToolResult> {
  const started = Date.now();
  switch (id) {
    case CALCULATOR_TOOL:
      return calculator(args, started);
    case CURRENT_TIME_TOOL:
      return currentTime(args, started, deps.now?.() ?? new Date());
    case WEB_FETCH_TOOL:
      return webFetch(args, started, deps);
    default:
      return failed(`There is no builtin tool '${id}'.`, started);
  }
}
