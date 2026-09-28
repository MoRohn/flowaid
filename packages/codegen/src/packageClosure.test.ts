import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  PACKAGE_VERSIONS,
  RUNTIME_DEPENDENCIES,
  nodeTypes,
  packageClosure,
  providerIds,
} from "./packageClosure.js";
import { REPO, planOf } from "./test/support.js";

describe("packageClosure", () => {
  it("adds the provider packages of the plan's model refs and closes over dependencies", () => {
    const plan = planOf("example-support-reply");
    expect(providerIds(plan)).toEqual(["openai", "typesafe"]);
    expect(packageClosure(plan)).toEqual([
      "credentials",
      "env",
      "knowledge",
      "mcp",
      "node-sdk",
      "nodes-core",
      "observability",
      "pageindex",
      "provider-openai",
      "provider-typesafe",
      "providers",
      "shared",
      "workflow-compiler",
      "workflow-core",
      "workflow-runtime",
      "workflow-sdk",
    ]);
  });

  it("adds mcp for MCP nodes and anthropic for the research agent's model", () => {
    expect(nodeTypes(planOf("github-issue-triage"))).toContain("flowaid.tools.mcp");
    expect(packageClosure(planOf("research-agent"))).toContain("provider-anthropic");
    expect(packageClosure(planOf("research-agent"))).not.toContain("sandbox");
  });

  it("vendors pageindex for the PageIndex templates", () => {
    expect(nodeTypes(planOf("variants/pageindex-document-qa"))).toEqual([
      "flowaid.ai.generate",
      "flowaid.pageindex.cite",
      "flowaid.pageindex.retrieve",
    ]);
    expect(packageClosure(planOf("variants/pageindex-document-qa"))).toContain("pageindex");
  });

  it("knows each package's real version and @flowaid dependencies", () => {
    expect(Object.keys(PACKAGE_VERSIONS).sort()).toEqual(Object.keys(RUNTIME_DEPENDENCIES).sort());
    for (const [short, deps] of Object.entries(RUNTIME_DEPENDENCIES)) {
      let pkg: {
        version: string;
        dependencies?: Record<string, string>;
        optionalDependencies?: Record<string, string>;
      };
      try {
        pkg = JSON.parse(
          readFileSync(join(REPO, "packages", short, "package.json"), "utf8"),
        ) as typeof pkg;
      } catch {
        continue; // not in this repository yet (langchain packages)
      }
      const actual = Object.keys({ ...pkg.dependencies, ...pkg.optionalDependencies })
        .filter((d) => d.startsWith("@flowaid/"))
        .map((d) => d.slice("@flowaid/".length))
        .sort();
      expect(actual, short).toEqual([...deps].sort());
      expect(PACKAGE_VERSIONS[short], short).toBe(pkg.version);
    }
  });
});
