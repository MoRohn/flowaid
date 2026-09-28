import { describe, expect, it } from "vitest";
import { isLocalHostname, isLoopbackAddress, localSignInRefusal } from "../routes/auth.js";

const ok = {
  socketAddress: "127.0.0.1",
  headers: { "x-requested-with": "flowaid", host: "localhost:3000" },
};

describe("local sign-in checks", () => {
  it("knows loopback addresses and local names", () => {
    for (const a of ["127.0.0.1", "127.1.2.3", "::1", "::ffff:127.0.0.1"])
      expect(isLoopbackAddress(a)).toBe(true);
    for (const a of ["10.0.0.2", "192.168.1.9", "::ffff:10.0.0.1", "", undefined])
      expect(isLoopbackAddress(a)).toBe(false);
    for (const h of ["localhost", "app.localhost", "127.0.0.1", "[::1]"])
      expect(isLocalHostname(h)).toBe(true);
    for (const h of ["evil.example", "localhost.evil.example", "10.0.0.1"])
      expect(isLocalHostname(h)).toBe(false);
  });

  it("accepts this computer, through the web app's proxy too", () => {
    expect(localSignInRefusal(ok)).toBeNull();
    expect(
      localSignInRefusal({
        socketAddress: "::1",
        headers: {
          ...ok.headers,
          "x-forwarded-for": "127.0.0.1",
          "x-forwarded-host": "127.0.0.1:3001",
          origin: "http://127.0.0.1:3001",
        },
      }),
    ).toBeNull();
  });

  it("refuses other computers, rebinding hosts, cross-site pages and missing CSRF headers", () => {
    expect(localSignInRefusal({ ...ok, socketAddress: "192.168.1.20" })).toMatch(/loopback/);
    expect(
      localSignInRefusal({ ...ok, headers: { ...ok.headers, "x-forwarded-for": "192.168.1.20" } }),
    ).toMatch(/another computer/);
    expect(
      localSignInRefusal({ ...ok, headers: { ...ok.headers, host: "rebind.evil.example:3000" } }),
    ).toMatch(/host/);
    expect(
      localSignInRefusal({
        ...ok,
        headers: { ...ok.headers, "x-forwarded-host": "rebind.evil.example" },
      }),
    ).toMatch(/host/);
    expect(
      localSignInRefusal({ ...ok, headers: { ...ok.headers, origin: "https://evil.example" } }),
    ).toMatch(/origin/);
    expect(localSignInRefusal({ ...ok, headers: { host: "localhost" } })).toMatch(
      /X-Requested-With/,
    );
  });
});
