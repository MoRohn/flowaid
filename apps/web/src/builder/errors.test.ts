import { describe, expect, it } from "vitest";
import { ApiError } from "~/api/client";
import { describeInputIssue, describeRunError } from "./errors";

describe("describeRunError", () => {
  it("names each input field the server rejected, keeping the request id", () => {
    const e = new ApiError(
      400,
      "BAD_REQUEST",
      "the input does not match the workflow's inputs schema",
      { issues: [{ path: "/", message: "must have required property 'customer_id'" }] },
      "req-1",
    );
    expect(describeRunError(e)).toMatchObject({
      kind: "input",
      items: ["Customer id is required"],
      code: "BAD_REQUEST",
      requestId: "req-1",
    });
  });

  it("tells an unbound secret apart from other draft problems", () => {
    const unbound = new ApiError(422, "WORKFLOW_VALIDATION_ERROR", "1 diagnostic(s)", {
      diagnostics: [
        {
          code: "E_SECRET_UNBOUND",
          message: "secret OPENAI_API_KEY is not bound in this environment",
        },
      ],
    });
    expect(describeRunError(unbound)).toMatchObject({
      kind: "secrets",
      items: ["secret OPENAI_API_KEY is not bound in this environment"],
    });
    const draft = new ApiError(422, "WORKFLOW_VALIDATION_ERROR", "1 diagnostic(s)", {
      diagnostics: [{ code: "E_TOOL_UNRESOLVED", message: "Choose the MCP tool this node calls" }],
    });
    expect(describeRunError(draft).kind).toBe("draft");
  });

  it("separates connectivity, permission, rate limits and server failures", () => {
    expect(describeRunError(new TypeError("Failed to fetch")).kind).toBe("connection");
    expect(describeRunError(new ApiError(403, "FORBIDDEN", "no")).kind).toBe("permission");
    expect(describeRunError(new ApiError(401, "UNAUTHORIZED", "no")).action).toMatch(/Reload/);
    expect(describeRunError(new ApiError(429, "RATE_LIMITED", "slow down")).kind).toBe("busy");
    expect(describeRunError(new ApiError(412, "PRECONDITION_FAILED", "stale")).kind).toBe(
      "conflict",
    );
    expect(describeRunError(new ApiError(503, "UNAVAILABLE", "down"))).toMatchObject({
      kind: "server",
      items: ["down"],
    });
  });
});

describe("describeInputIssue", () => {
  it("reads nested paths by field name", () => {
    expect(describeInputIssue({ path: "/order/total_amount", message: "must be number" })).toBe(
      "Order › Total amount must be number",
    );
    expect(describeInputIssue({ path: "/", message: "must be object" })).toBe("Must be object");
  });
});
