import { describe, expect, it } from "vitest";
import type { SafeFetch } from "@flowaid/workflow-core";
import { BUILTIN_AGENT_TOOLS, isBuiltinAgentTool } from "./definitions.js";
import { evaluateArithmetic, runBuiltinTool } from "./run.js";

const signal = new AbortController().signal;
const noFetch: SafeFetch = () => Promise.reject(new Error("no network in this test"));
const run = (id: string, args: unknown, fetch: SafeFetch = noFetch, now?: Date) =>
  runBuiltinTool(id, args as never, { fetch, signal, ...(now ? { now: () => now } : {}) });

describe("builtin tool definitions", () => {
  it("keep to the schema subset every provider's function calling accepts", () => {
    const keys = new Set<string>();
    const walk = (v: unknown) => {
      if (Array.isArray(v)) return v.forEach(walk);
      if (v && typeof v === "object")
        for (const [k, x] of Object.entries(v)) {
          keys.add(k);
          if (k !== "properties") walk(x);
          else Object.values(x as object).forEach(walk);
        }
    };
    for (const t of BUILTIN_AGENT_TOOLS) walk(t.inputSchema);
    expect([...keys].sort()).toEqual(["description", "properties", "required", "type"]);
    for (const t of BUILTIN_AGENT_TOOLS) {
      expect(t.name).toMatch(/^[a-z_]{1,64}$/);
      expect(t.idempotency).toBe("safe");
      expect(isBuiltinAgentTool(t.name)).toBe(true);
    }
    expect(isBuiltinAgentTool("agent_preset")).toBe(false);
  });
});

describe("calculator", () => {
  it("evaluates with precedence, powers, functions and constants", () => {
    expect(evaluateArithmetic("(1200 * 0.15) + 49.99")).toBe(229.99);
    expect(evaluateArithmetic("2 + 3 * 4 ^ 2")).toBe(50);
    expect(evaluateArithmetic("-2^2")).toBe(-4);
    expect(evaluateArithmetic("2^-1")).toBe(0.5);
    expect(evaluateArithmetic("0.1 + 0.2")).toBe(0.3);
    expect(evaluateArithmetic("round(100 / 3, 2)")).toBe(33.33);
    expect(evaluateArithmetic("max(3, 9, 4) - min(2, 8)")).toBe(7);
    expect(evaluateArithmetic("sqrt(16) + log(1000) + ln(e)")).toBe(8);
    expect(evaluateArithmetic("10 % 4 + 1.5e3")).toBe(1502);
    expect(evaluateArithmetic("12 × 3 ÷ 4")).toBe(9);
    expect(evaluateArithmetic("2 ** 10")).toBe(1024);
    expect(evaluateArithmetic("round(2.675, 2)")).toBe(2.68);
  });

  it("answers mistakes with a message the model can act on, never by running code", async () => {
    for (const [expression, message] of [
      ["1 / 0", "division by zero"],
      ["2 +", "ends too early"],
      ["(1 + 2", "expected ')'"],
      ["process(1)", "'process' is not a known function"],
      ["process.exit(1)", "'.' is not part of arithmetic"],
      ["alert('x')", "is not part of arithmetic"],
      ["sqrt(1, 2)", "sqrt takes 1 argument"],
      ["1 2", "unexpected '2'"],
    ]) {
      const r = await run("calculator", { expression });
      expect(r.ok, expression).toBe(false);
      expect(r.error?.message, expression).toContain(message);
    }
    const r = await run("calculator", {});
    expect(r.error?.message).toMatch(/Give the expression/);
  });

  it("returns the result as JSON content and structured output", async () => {
    const r = await run("calculator", { expression: "19.99 * 3" });
    expect(r).toMatchObject({ ok: true, structured: { expression: "19.99 * 3", result: 59.97 } });
    expect(JSON.parse(r.content)).toEqual({ expression: "19.99 * 3", result: 59.97 });
  });
});

describe("current_time", () => {
  const now = new Date("2026-03-29T00:30:00Z");

  it("gives UTC by default and the local time, weekday and offset in a zone", async () => {
    const utc = await run("current_time", {}, noFetch, now);
    expect(utc.structured).toEqual({
      iso: "2026-03-29T00:30:00Z",
      date: "2026-03-29",
      time: "00:30:00",
      weekday: "Sunday",
      timezone: "UTC",
      utc_offset: "+00:00",
      unix: 1774744200,
    });
    const paris = await run("current_time", { timezone: "Europe/Paris" }, noFetch, now);
    expect(paris.structured).toMatchObject({
      iso: "2026-03-29T01:30:00+01:00",
      utc_offset: "+01:00",
    });
    const ny = await run("current_time", { timezone: "America/New_York" }, noFetch, now);
    expect(ny.structured).toMatchObject({ date: "2026-03-28", weekday: "Saturday" });
  });

  it("explains an unknown time zone", async () => {
    const r = await run("current_time", { timezone: "Mars/Olympus" });
    expect(r.ok).toBe(false);
    expect(r.error?.message).toMatch(/not a time zone. Use an IANA name/);
  });
});

describe("web_fetch", () => {
  const page =
    (body: string, type = "text/html; charset=utf-8", status = 200): SafeFetch =>
    () =>
      Promise.resolve(new Response(body, { status, headers: { "content-type": type } }));

  it("returns a page's title and main text as Markdown", async () => {
    let asked: RequestInit | undefined;
    const fetch: SafeFetch = (url, init) => {
      asked = init;
      expect(url).toBe("https://docs.example.com/refunds");
      return page(
        "<html><head><title>Refund policy</title><script>evil()</script></head><body><nav>Menu</nav><main><h1>Refunds</h1><p>Refunds take <b>5 business days</b>.</p></main></body></html>",
      )(url, init);
    };
    const r = await run("web_fetch", { url: "https://docs.example.com/refunds" }, fetch);
    expect(r.ok).toBe(true);
    expect(r.structured).toMatchObject({
      status: 200,
      content_type: "text/html",
      title: "Refund policy",
      truncated: false,
    });
    const content = (r.structured as { content: string }).content;
    expect(content).toContain("Refunds take");
    expect(content).not.toContain("evil");
    expect(content).not.toContain("Menu");
    expect(asked).toMatchObject({ method: "GET", maxRedirects: 5 });
  });

  it("cuts long pages to the requested length, within 500 to 20 000 characters", async () => {
    const r = await run(
      "web_fetch",
      { url: "https://example.com/a", max_characters: 10 },
      page("x".repeat(5000), "text/plain"),
    );
    expect(r.structured).toMatchObject({ truncated: true });
    expect((r.structured as { content: string }).content).toHaveLength(502);
  });

  it("refuses addresses, statuses and file types it cannot read, in words", async () => {
    expect((await run("web_fetch", { url: "file:///etc/passwd" })).error?.message).toMatch(
      /full address|Only http/,
    );
    expect((await run("web_fetch", { url: "ftp://x.example" })).error?.message).toMatch(
      /Only http and https/,
    );
    const missing = await run(
      "web_fetch",
      { url: "https://example.com/gone" },
      page("nope", "text/html", 404),
    );
    expect(missing.error).toMatchObject({ retryable: false });
    expect(missing.error?.message).toMatch(/answered 404/);
    const pdf = await run(
      "web_fetch",
      { url: "https://example.com/a.pdf" },
      page("%PDF", "application/pdf"),
    );
    expect(pdf.error?.message).toMatch(/application\/pdf, not a text page/);
    // the guarded fetch refusing a private address reaches the model as a message
    const blocked = await run("web_fetch", { url: "http://10.0.0.5/admin" }, () =>
      Promise.reject(new Error("address 10.0.0.5 is private")),
    );
    expect(blocked.error?.message).toMatch(/Could not read .* private/);
  });
});
