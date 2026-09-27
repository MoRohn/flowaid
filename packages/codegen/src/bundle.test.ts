import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { NodeRun } from "@flowaid/workflow-core";
import { buildExportBundle, type ExportBundleInput } from "./bundle.js";
import { packageClosure } from "./packageClosure.js";
import { readZip } from "./zip.js";
import { fixture, planOf } from "./test/support.js";

const plan = planOf("example-support-reply");
const definition = fixture("example-support-reply") as { id: string; name: string };
const base: ExportBundleInput = {
  definition,
  plan,
  workflow: { id: definition.id, slug: "support-reply", name: "Support reply" },
  version: 3,
  mode: "npm",
  versions: Object.fromEntries(packageClosure(plan).map((s) => [s, "0.1.0"])),
};
const text = (v: string | Uint8Array | undefined) =>
  typeof v === "string" ? v : new TextDecoder().decode(v);

describe("buildExportBundle", () => {
  it("assembles the package under flowaid-<slug>-v<version>/ and zips it", async () => {
    const bundle = await buildExportBundle(base);
    expect(bundle.root).toBe("flowaid-support-reply-v3");
    expect(bundle.fileName).toBe("flowaid-support-reply-v3.zip");
    expect([...bundle.files.keys()].sort()).toEqual([
      ".env.example",
      ".gitignore",
      "Dockerfile",
      "LICENSE",
      "NOTICE",
      "README.md",
      "inputs/example.json",
      "package.json",
      "src/client.ts",
      "src/flow.ts",
      "src/nodes.ts",
      "src/providers.ts",
      "src/run.ts",
      "src/sandbox.ts",
      "src/serve.ts",
      "src/validate.ts",
      "src/workflow.ts",
      "tests/fakes.ts",
      "tests/workflow.test.ts",
      "tsconfig.json",
      "workflow.json",
      "workflow.plan.json",
    ]);
    const zip = readZip(bundle.toZip());
    expect(zip.size).toBe(bundle.files.size);
    expect(text(zip.get("flowaid-support-reply-v3/src/workflow.ts"))).toBe(
      bundle.files.get("src/workflow.ts"),
    );

    const pkg = JSON.parse(text(bundle.files.get("package.json"))) as {
      scripts: Record<string, string>;
      dependencies: Record<string, string>;
    };
    expect(Object.keys(pkg.scripts)).toEqual(["flow", "serve", "remote", "validate", "test"]);
    expect(pkg.dependencies["@flowaid/provider-openai"]).toBe("0.1.0");
    expect(pkg.dependencies["@flowaid/provider-anthropic"]).toBeUndefined();

    const env = text(bundle.files.get(".env.example"));
    expect(env).toMatch(/^TYPESAFE_API_KEY=$/m);
    expect(env).toMatch(/^CRM_TOKEN=$/m);
    const providers = text(bundle.files.get("src/providers.ts"));
    expect(providers).toContain("typesafeFactory()");
    expect(providers).toContain("openaiFactories()");
    expect(providers).not.toContain("anthropic");
    expect(text(bundle.files.get("src/client.ts"))).toContain(`"${definition.id}"`);
    // Generated from the schema; nothing personal.
    expect(JSON.parse(text(bundle.files.get("inputs/example.json")))).toEqual({
      message: "example",
      customer_id: "example",
      tier: "free",
    });
  });

  it("replaces personal data in the sample input and the recorded run, and lists it in the README", async () => {
    const nodeRun = {
      id: "01900000-0000-7000-8000-0000000000aa",
      runId: "01900000-0000-7000-8000-0000000000bb",
      nodeId: "draft",
      scope: "",
      attempt: 1,
      status: "completed",
      kind: "task",
      nodeType: "flowaid.ai.generate",
      nodeName: "Draft reply",
      input: { prompt: "Customer message: my card 4111 1111" },
      output: { text: "Hello Ada", usage: { $redacted: true } },
      firedPorts: ["done"],
      decision: null,
      error: null,
      usage: null,
      costUsd: 0,
      latencyMs: 1,
      queueLatencyMs: 0,
      idempotencyKey: null,
      inputHash: "h",
      reusedFromNodeRunId: null,
      pool: "general",
      scheduledSeq: 1,
      endedSeq: 2,
      startedAt: null,
      endedAt: null,
    } as unknown as NodeRun;
    const bundle = await buildExportBundle({
      ...base,
      sampleInput: { message: "my card 4111 1111 was charged", customer_id: "c_42", tier: "gold" },
      recordedRun: {
        input: { message: "my card 4111 1111 was charged", customer_id: "c_42" },
        status: "completed",
        outcome: "auto",
        output: { reply: "Hello Ada", team: "billing", auto_sent: true, approved_by: null },
        nodeRuns: [nodeRun],
      },
    });
    expect(JSON.parse(text(bundle.files.get("inputs/example.json")))).toEqual({
      message: "[redacted]",
      customer_id: "c_42",
      tier: "gold",
    });
    const recorded = text(bundle.files.get("tests/recorded-run.json"));
    expect(recorded).not.toMatch(/4111/);
    expect(recorded).not.toContain('"input": { "prompt"'); // node inputs are never exported
    expect(JSON.parse(recorded)).toMatchObject({ exact: false, status: "completed" });
    // The draft consumed the pii message, so its output (and the run output built from it) are
    // personal too: both become placeholders.
    expect(recorded).not.toContain("Hello Ada");
    expect(bundle.placeholders.map((p) => p.location)).toEqual([
      "inputs/example.json#/message",
      "tests/recorded-run.json#/nodeRuns/draft/output",
      "tests/recorded-run.json#/input/message",
      "tests/recorded-run.json#/output",
    ]);
    const readme = text(bundle.files.get("README.md"));
    expect(readme).toContain("## Placeholders");
    expect(readme).toContain("`inputs/example.json#/message` (pii)");
  });

  it("vendored: ships the closure's tarballs with SHA256SUMS and pins them by file:", async () => {
    const closure = packageClosure(plan);
    const vendor = [...closure, "sandbox"].map((short) => ({
      name: `flowaid-${short}-0.1.0.tgz`,
      data: new TextEncoder().encode(`tarball of ${short}`),
    }));
    const bundle = await buildExportBundle({ ...base, mode: "vendored", vendor });
    const pkg = JSON.parse(text(bundle.files.get("package.json"))) as {
      dependencies: Record<string, string>;
      pnpm: { overrides: Record<string, string> };
    };
    expect(pkg.dependencies["@flowaid/workflow-runtime"]).toBe(
      "file:./vendor/flowaid-workflow-runtime-0.1.0.tgz",
    );
    expect(pkg.pnpm.overrides["@flowaid/shared"]).toBe("file:./vendor/flowaid-shared-0.1.0.tgz");
    // Only the closure is shipped (no sandbox for this flow).
    const shipped = [...bundle.files.keys()].filter((f) => f.endsWith(".tgz"));
    expect(shipped).toHaveLength(closure.length);
    expect(shipped).not.toContain("vendor/flowaid-sandbox-0.1.0.tgz");
    const sums = text(bundle.files.get("vendor/SHA256SUMS"));
    const shared = createHash("sha256").update("tarball of shared").digest("hex");
    expect(sums).toContain(`${shared}  flowaid-shared-0.1.0.tgz`);
    expect(bundle.files.has("tests/vendor-integrity.test.ts")).toBe(true);

    await expect(
      buildExportBundle({ ...base, mode: "vendored", vendor: vendor.slice(1) }),
    ).rejects.toThrow(/missing tarballs for @flowaid\/credentials/);
  });
});
