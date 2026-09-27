import { describe, expect, it } from "vitest";
import {
  isReadOnly,
  parseSpec,
  searchAction,
  type PluginRow,
  type PluginSearchRow,
} from "./plugins";

const row = (over: Partial<PluginRow>): PluginRow => ({
  id: "p",
  packageName: "@acme/nodes-crm",
  version: "1.0.0",
  source: "npm",
  integrity: "sha512-x",
  status: "enabled",
  pool: "general",
  error: null,
  scope: "workspace",
  nodes: [],
  installedAt: "2026-09-27T00:00:00Z",
  ...over,
});
const hit = (over: Partial<PluginSearchRow>): PluginSearchRow => ({
  name: "@acme/nodes-crm",
  version: "1.2.0",
  description: "",
  keywords: ["flowaid-node"],
  publisher: null,
  date: null,
  links: {},
  score: 1,
  allowed: true,
  installed: null,
  ...over,
});

describe("plugins tab helpers", () => {
  it("keeps bundled and global rows read-only", () => {
    expect(isReadOnly(row({}))).toBe(false);
    expect(isReadOnly(row({ source: "bundled", scope: "global" }))).toBe(true);
  });
  it("parses install specs", () => {
    expect(parseSpec("@acme/nodes-crm@^1.2.0")).toEqual({
      packageName: "@acme/nodes-crm",
      version: "^1.2.0",
    });
    expect(parseSpec(" flowaid-node-weather ")).toEqual({
      packageName: "flowaid-node-weather",
      version: "latest",
    });
    expect(parseSpec("")).toMatch(/Enter/);
    expect(parseSpec("Bad Name")).toMatch(/npm package name/);
    expect(parseSpec("@acme/x@")).toMatch(/version/);
  });
  it("labels search results by install state and the allow-list", () => {
    expect(searchAction(hit({}))).toEqual({ label: "Install", disabled: false });
    expect(searchAction(hit({ installed: "1.0.0" }))).toEqual({
      label: "Upgrade to 1.2.0",
      disabled: false,
    });
    expect(searchAction(hit({ installed: "1.2.0" }))).toEqual({
      label: "Installed",
      disabled: true,
    });
    expect(searchAction(hit({ allowed: false })).disabled).toBe(true);
  });
});
