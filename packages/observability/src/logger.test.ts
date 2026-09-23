import { describe, expect, it } from "vitest";
import { REDACTED, Redactor } from "@flowaid/credentials";
import { createLogger, scrubLine, type LogBindings } from "./logger.js";

function capture(bindings: LogBindings = {}, redactor?: Redactor) {
  const lines: string[] = [];
  const logger = createLogger(bindings, {
    level: "debug",
    destination: { write: (line: string) => lines.push(line) },
    ...(redactor ? { redactor } : {}),
  });
  const parsed = () => lines.map((l) => JSON.parse(l) as Record<string, unknown>);
  return { logger, lines, parsed };
}

const SECRET = "sk-live-9f8e7d6c5b4a3f2e1d0c";

describe("createLogger", () => {
  it("redacts a learned secret and an Authorization header end to end", () => {
    const redactor = new Redactor().learn([SECRET]);
    const { logger, lines, parsed } = capture(
      { service: "flowaid-api", requestId: "req-1" },
      redactor,
    );
    logger.info(
      {
        req: {
          method: "POST",
          url: "/v1/runs",
          headers: {
            authorization: "Bearer fa_live_abcdef123456",
            cookie: "sid=abc",
            "x-signature": "sha256=deadbeef",
          },
          query: { t: "review-link-token" },
        },
        res: { statusCode: 200, headers: { "set-cookie": "sid=new" } },
        providerRequest: { body: { key: SECRET } },
      },
      `calling the provider with ${SECRET}`,
    );
    const text = lines.join("");
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain("fa_live_abcdef123456");
    expect(text).not.toContain("review-link-token");
    expect(text).not.toContain("sid=abc");
    expect(text).not.toContain("sid=new");
    expect(text).not.toContain("deadbeef");
    const [line] = parsed();
    expect(line).toMatchObject({
      level: "info",
      service: "flowaid-api",
      requestId: "req-1",
      msg: `calling the provider with ${REDACTED}`,
      req: {
        method: "POST",
        headers: { authorization: REDACTED, cookie: REDACTED },
        query: { t: REDACTED },
      },
      providerRequest: { body: { key: REDACTED } },
    });
  });

  it("redacts secrets in child bindings, error stacks and base64 forms", () => {
    const redactor = new Redactor().learn([SECRET]);
    const { logger, lines } = capture({}, redactor);
    const child = logger.child({ runId: "run-1", nodeRunId: "nr-1", leaked: SECRET });
    child.error({ err: new Error(`401 for key ${SECRET}`) }, "provider failed");
    child.warn({ header: Buffer.from(SECRET).toString("base64") }, "encoded");
    const text = lines.join("");
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain(Buffer.from(SECRET).toString("base64"));
    expect(text).toContain('"runId":"run-1"');
    for (const line of lines) expect(() => JSON.parse(line) as unknown).not.toThrow();
  });

  it("redacts secrets that JSON escaping changes", () => {
    const tricky = 'pa"ss\\word-2026';
    const { logger, lines } = capture({}, new Redactor().learn([tricky]));
    logger.info({ value: tricky }, "escaped");
    expect(lines[0]).not.toContain("ss\\\\word");
    expect(JSON.parse(lines[0] ?? "{}")).toMatchObject({ value: REDACTED });
  });

  it("scrubs bearer and basic credentials it never learned", () => {
    const { logger, parsed } = capture();
    logger.info(`retrying with Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig`);
    logger.info({ headers: { authorization: "Basic dXNlcjpwYXNzd29yZA==" } }, "outgoing");
    const [first, second] = parsed();
    expect(first?.msg).toBe(`retrying with Authorization: Bearer ${REDACTED}`);
    expect(second).toMatchObject({ headers: { authorization: REDACTED } });
  });

  it("drops undefined bindings and respects the level", () => {
    const lines: string[] = [];
    const logger = createLogger(
      { service: "flowaid-worker", runId: undefined },
      { level: "warn", destination: { write: (l: string) => lines.push(l) } },
    );
    logger.info("hidden");
    logger.warn("shown");
    expect(lines).toHaveLength(1);
    const line = JSON.parse(lines[0] ?? "{}") as Record<string, unknown>;
    expect(line).toMatchObject({ level: "warn", service: "flowaid-worker", msg: "shown" });
    expect(line).not.toHaveProperty("runId");
    expect(typeof line.time).toBe("string");
  });

  it("scrubLine leaves ordinary text alone", () => {
    expect(scrubLine("Bearer short")).toBe("Bearer short");
    expect(scrubLine("a basic sentence about Basic plans")).toBe(
      "a basic sentence about Basic plans",
    );
  });
});
