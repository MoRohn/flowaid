/**
 * Tools built into FlowAId that any agent can use without connecting anything: exact arithmetic,
 * the current date and time, and reading a public web page. Data only (no executors), so the API
 * can list them through `@flowaid/nodes-core/manifest`; the worker runs them (`runBuiltinTool`).
 *
 * The input schemas keep to the JSON Schema subset every model provider's function calling
 * accepts (type, properties, required, description, enum): no `format`, bounds or
 * `additionalProperties`, which some providers reject. Limits are checked when the tool runs.
 */
import type { ToolDefinition } from "@flowaid/workflow-core";

export const CALCULATOR_TOOL = "calculator";
export const CURRENT_TIME_TOOL = "current_time";
export const WEB_FETCH_TOOL = "web_fetch";

/** Characters of page text `web_fetch` returns by default, and at most. */
export const WEB_FETCH_DEFAULT_CHARS = 8_000;
export const WEB_FETCH_MAX_CHARS = 20_000;

export const BUILTIN_AGENT_TOOLS: readonly ToolDefinition[] = [
  {
    name: CALCULATOR_TOOL,
    description:
      "Evaluates an arithmetic expression exactly and returns the number. Use it for any sum, percentage, unit conversion or other calculation instead of working it out yourself. Supports + - * / % ^, parentheses, and the functions sqrt, abs, round, floor, ceil, min, max, pow, log (base 10), ln and exp, with the constants pi and e.",
    inputSchema: {
      type: "object",
      properties: {
        expression: {
          type: "string",
          description:
            "The expression to evaluate, for example (1200 * 0.15) + 49.99 or round(100 / 3, 2).",
        },
      },
      required: ["expression"],
    },
    outputSchema: {
      type: "object",
      properties: { expression: { type: "string" }, result: { type: "number" } },
      required: ["expression", "result"],
    },
    idempotency: "safe",
    approvalRequired: false,
    source: { kind: "builtin", id: CALCULATOR_TOOL },
  },
  {
    name: CURRENT_TIME_TOOL,
    description:
      "Returns the current date and time: ISO timestamp, date, time, weekday and UTC offset in a time zone. Use it whenever the answer depends on today's date or the time, such as deadlines, ages or opening hours.",
    inputSchema: {
      type: "object",
      properties: {
        timezone: {
          type: "string",
          description:
            "An IANA time zone name such as Europe/Paris or America/New_York. Leave it out for UTC.",
        },
      },
      required: [],
    },
    outputSchema: {
      type: "object",
      properties: {
        iso: { type: "string" },
        date: { type: "string" },
        time: { type: "string" },
        weekday: { type: "string" },
        timezone: { type: "string" },
        utc_offset: { type: "string" },
        unix: { type: "integer" },
      },
      required: ["iso", "date", "time", "weekday", "timezone", "utc_offset", "unix"],
    },
    idempotency: "safe",
    approvalRequired: false,
    source: { kind: "builtin", id: CURRENT_TIME_TOOL },
  },
  {
    name: WEB_FETCH_TOOL,
    description:
      "Reads a public web page and returns its title and main text as Markdown. Use it to look at a page whose address you know, such as documentation or an article. Only http and https addresses on the public internet; logins, forms and scripts are not run.",
    inputSchema: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "The full address of the page, starting with https:// or http://.",
        },
        max_characters: {
          type: "integer",
          description: `How much of the page text to return, from 500 to ${WEB_FETCH_MAX_CHARS} characters. Defaults to ${WEB_FETCH_DEFAULT_CHARS}.`,
        },
      },
      required: ["url"],
    },
    outputSchema: {
      type: "object",
      properties: {
        url: { type: "string" },
        status: { type: "integer" },
        content_type: { type: "string" },
        title: { type: "string" },
        content: { type: "string" },
        truncated: { type: "boolean" },
      },
      required: ["url", "status", "content_type", "content", "truncated"],
    },
    capability: "web.read",
    idempotency: "safe",
    approvalRequired: false,
    source: { kind: "builtin", id: WEB_FETCH_TOOL },
  },
];

const BUILTIN_NAMES = new Set(BUILTIN_AGENT_TOOLS.map((t) => t.name));

/** Whether a builtin tool source is one of these (not the MCP or agent-preset builtins). */
export function isBuiltinAgentTool(id: string): boolean {
  return BUILTIN_NAMES.has(id);
}
