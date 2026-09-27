import { describe, expect, it } from "vitest";
import { NAV, NAV_SECONDARY, visibleNav } from "./nav";

describe("feature-keyed navigation", () => {
  it("renders an entry only when the API reports its feature", () => {
    const ids = (f: Record<string, boolean>) => visibleNav(NAV, f).map((e) => e.id);
    expect(ids({})).toEqual([]);
    expect(ids({ workflows: true, runs: true })).toEqual(["workflows", "runs"]);
    expect(ids({ integrations_openapi: true })).toEqual(["integrations"]);
    expect(ids({ evaluations: false, credentials: true })).toEqual(["credentials"]);
  });
  it("keeps settings reachable for every signed-in user", () => {
    expect(visibleNav(NAV_SECONDARY, {}).map((e) => e.id)).toEqual(["settings"]);
  });
  it("gives every entry a unique id and path", () => {
    const all = [...NAV, ...NAV_SECONDARY];
    expect(new Set(all.map((e) => e.id)).size).toBe(all.length);
    expect(new Set(all.map((e) => e.path)).size).toBe(all.length);
  });
});
