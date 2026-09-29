import { describe, expect, it } from "vitest";
import { isLoopbackHost, sessionNotKeptMessage } from "./cookieHint";

describe("sessionNotKeptMessage", () => {
  it("knows which hosts keep a Secure cookie over http", () => {
    for (const h of ["localhost", "flowaid.localhost", "127.0.0.1", "[::1]"])
      expect(isLoopbackHost(h), h).toBe(true);
    for (const h of ["flowaid.lan", "192.168.1.20", "flowaid.example.com"])
      expect(isLoopbackHost(h), h).toBe(false);
  });

  it("names the fix when FlowAId is opened by machine name over plain http", () => {
    const m = sessionNotKeptMessage({ protocol: "http:", hostname: "flowaid.lan" });
    expect(m).toContain("http://flowaid.lan");
    expect(m).toContain("FLOWAID_ALLOW_INSECURE_HTTP=true");
    expect(m).toContain("https");
  });

  it("falls back to cookies being blocked elsewhere", () => {
    expect(sessionNotKeptMessage({ protocol: "https:", hostname: "flowaid.example.com" })).toMatch(
      /Allow cookies/,
    );
  });
});
