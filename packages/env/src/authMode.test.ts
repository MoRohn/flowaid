import { describe, expect, it } from "vitest";
import { crossFieldIssues, resolveAuthMode } from "./schema.js";

describe("FLOWAID_AUTH_MODE", () => {
  it("auto is local on this computer and password behind public URLs", () => {
    expect(resolveAuthMode({})).toBe("local");
    expect(
      resolveAuthMode({
        FLOWAID_BASE_URL: "http://127.0.0.1:3001",
        FLOWAID_WEB_URL: "http://localhost:3000",
      }),
    ).toBe("local");
    expect(
      resolveAuthMode({
        FLOWAID_BASE_URL: "https://api.example.com",
        FLOWAID_WEB_URL: "https://app.example.com",
      }),
    ).toBe("password");
    expect(resolveAuthMode({ FLOWAID_AUTH_MODE: "password" })).toBe("password");
  });

  it("refuses an explicit local mode behind a public URL", () => {
    const issues = crossFieldIssues({
      FLOWAID_AUTH_MODE: "local",
      FLOWAID_WEB_URL: "https://app.example.com",
    });
    expect(issues.map((i) => i.path)).toContain("FLOWAID_WEB_URL");
    expect(
      crossFieldIssues({ FLOWAID_AUTH_MODE: "local", FLOWAID_WEB_URL: "http://localhost:3000" }),
    ).toEqual([]);
  });
});
