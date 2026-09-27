/**
 * `buildExportBundle(input)` (CODE_EXPORT.md §1): assembles the package's file map under
 * `flowaid-<slug>-v<version>/` and zips it. It reads nothing itself — the caller passes the stored
 * definition and plan and, optionally, persisted (already redacted) run data, which is scrubbed
 * once more here: `x-dataClass: pii | sensitive` fields and `$redacted` stubs become placeholders,
 * node runs of `privacy.sensitive` nodes are left out, node inputs are never included. The
 * generated `src/workflow.ts` must reproduce the definition's hash (CODEGEN_ROUNDTRIP otherwise).
 */
import { createHash } from "node:crypto";
import type { ExecutionPlan, JsonValue, NodeRun, RunStatus } from "@flowaid/workflow-core";
import { ExecutionPlanSchema, WorkflowDefinitionSchema } from "@flowaid/workflow-core";
import { assertRoundTrip, generateWorkflowTs } from "./generateWorkflowTs.js";
import {
  generateClient,
  generateDockerfile,
  generateEnvExample,
  generateExampleInput,
  generateFlow,
  generateLangchain,
  generateNodes,
  generateNotice,
  generatePackageJson,
  generateProviders,
  generateReadme,
  generateRunner,
  generateSandbox,
  generateServe,
  generateTests,
  generateTsconfig,
  generateValidate,
  template,
} from "./generators.js";
import { PACKAGE_VERSIONS, packageClosure } from "./packageClosure.js";
import { sampleFor, scrub, type Placeholder } from "./placeholders.js";
import { createZip } from "./zip.js";

/** A finished run to replay in the package's tests (persisted, redacted rows). */
export interface RecordedRunInput {
  input: JsonValue;
  status: RunStatus;
  outcome: string | null;
  output: JsonValue | null;
  nodeRuns: readonly NodeRun[];
}

export interface ExportBundleInput {
  /** The stored definition (secret names only). */
  definition: unknown;
  /** The stored plan of that definition. */
  plan: unknown;
  workflow: { id: string; slug: string; name: string };
  version: number | "draft";
  mode: "npm" | "vendored";
  /** npm mode: `@flowaid/<short>` → version. */
  versions?: Readonly<Record<string, string>>;
  /** vendored mode: the `pnpm pack` tarballs (`flowaid-<short>-<version>.tgz`). */
  vendor?: readonly { name: string; data: Uint8Array }[];
  /** The input of a run to use as `inputs/example.json` (persisted, already redacted). */
  sampleInput?: JsonValue;
  recordedRun?: RecordedRunInput;
}

export class ExportBundle {
  constructor(
    /** Top-level directory inside the zip, e.g. `flowaid-support-triage-v3`. */
    readonly root: string,
    /** Path (relative to `root`) → content. */
    readonly files: ReadonlyMap<string, string | Uint8Array>,
    /** Values replaced by placeholders (also listed in the README). */
    readonly placeholders: readonly Placeholder[],
    /** The definition hash the generated `src/workflow.ts` reproduces. */
    readonly definitionHash: string,
  ) {}

  /** `flowaid-<slug>-v<version>.zip` */
  get fileName(): string {
    return `${this.root}.zip`;
  }

  toZip(): Uint8Array {
    const encoder = new TextEncoder();
    return createZip(
      [...this.files].map(([path, content]) => ({
        path: `${this.root}/${path}`,
        data: typeof content === "string" ? encoder.encode(content) : content,
      })),
    );
  }
}

const TARBALL = /^flowaid-([a-z0-9-]+?)-(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)\.tgz$/;

/** Maps each closure package to its tarball; throws when one is missing. */
function vendorFiles(
  closure: readonly string[],
  vendor: readonly { name: string }[],
): Record<string, string> {
  const byShort = new Map<string, string>();
  for (const f of vendor) {
    const m = TARBALL.exec(f.name);
    if (m?.[1]) byShort.set(m[1], f.name);
  }
  const out: Record<string, string> = {};
  const missing: string[] = [];
  for (const short of closure) {
    const file = byShort.get(short);
    if (file) out[short] = file;
    else missing.push(`@flowaid/${short}`);
  }
  if (missing.length)
    throw new Error(`vendored export: missing tarballs for ${missing.join(", ")}`);
  return out;
}

const PERSONAL = new Set(["pii", "sensitive"]);

/**
 * Nodes whose outputs may carry personal data: the input node's `pii`/`sensitive` ports seed the
 * set, as does every node whose redaction rules or privacy policy mark personal data; then
 * anything fed by a tainted output over a data edge (refs, templates, expressions) is tainted
 * too. Conservative on purpose: a derived value ("Hello <name>") is as personal as its source.
 */
export function taintedNodes(plan: ExecutionPlan): Set<string> {
  const tainted = new Set<string>();
  const inputPorts = new Set<string>();
  const props = (plan.inputs.properties ?? {}) as Record<string, { "x-dataClass"?: string }>;
  for (const [port, schema] of Object.entries(props))
    if (PERSONAL.has(schema["x-dataClass"] ?? "")) inputPorts.add(port);
  for (const [id, node] of Object.entries(plan.nodes)) {
    const rules = node.redact.filter((r) => PERSONAL.has(r.dataClass));
    if (node.kind === "input") {
      for (const r of rules) {
        const port = /^\/out\/([^/]+)/.exec(r.pointer)?.[1];
        if (port) inputPorts.add(port);
      }
    } else if (rules.length > 0 || node.policy.privacy.containsPII) tainted.add(id);
  }
  const isTaintedSource = (node: string, port: string) =>
    tainted.has(node) || (plan.nodes[node]?.kind === "input" && inputPorts.has(port));
  for (let changed = true; changed;) {
    changed = false;
    for (const d of plan.dataEdges)
      if (!tainted.has(d.to.node) && isTaintedSource(d.from.node, d.from.port)) {
        tainted.add(d.to.node);
        changed = true;
      }
  }
  return tainted;
}

/** Every port value of a node output replaced by a placeholder from the port's schema. */
function placeholderOutput(value: JsonValue, ports: Record<string, unknown>): JsonValue {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return sampleFor(undefined, { redacted: true });
  return Object.fromEntries(
    Object.keys(value).map((port) => [port, sampleFor(ports[port], { redacted: true })]),
  );
}

function recordedRunFile(
  run: RecordedRunInput,
  plan: ExecutionPlan,
  placeholders: Placeholder[],
): JsonValue {
  const at = "tests/recorded-run.json#";
  const before = placeholders.length;
  const tainted = taintedNodes(plan);
  const nodeRuns = run.nodeRuns
    .filter((n) => !plan.nodes[n.nodeId]?.policy.privacy.sensitive)
    .map((n) => {
      const node = plan.nodes[n.nodeId];
      const outputs = node?.outputs ?? {};
      const location = `${at}/nodeRuns/${n.nodeId}/output`;
      let output: JsonValue;
      if (node?.kind === "input") output = scrub(n.output, plan.inputs, location, placeholders);
      else if (tainted.has(n.nodeId) && n.output !== null) {
        placeholders.push({ location, reason: "pii" });
        output = placeholderOutput(n.output, outputs);
      } else
        output = scrub(n.output, { type: "object", properties: outputs }, location, placeholders);
      // Provider payloads may echo the state; the decision itself is what replay needs.
      const decision = n.decision ? { ...n.decision, raw: undefined } : null;
      return {
        id: n.id,
        nodeId: n.nodeId,
        scope: n.scope,
        status: n.status,
        inputHash: n.inputHash,
        firedPorts: n.firedPorts,
        decision: JSON.parse(JSON.stringify(decision)) as JsonValue,
        output,
      };
    });
  const input = scrub(run.input, plan.inputs, `${at}/input`, placeholders);
  const outputTainted = Object.entries(plan.nodes).some(
    ([id, n]) => n.kind === "output" && tainted.has(id),
  );
  let output: JsonValue = null;
  if (run.output !== null && outputTainted) {
    placeholders.push({ location: `${at}/output`, reason: "pii" });
    output = placeholderOutput(run.output, plan.outputs.properties ?? {});
  } else if (run.output !== null)
    output = scrub(run.output, plan.outputs, `${at}/output`, placeholders);
  return {
    // Replay reuses recorded outputs by input hash; placeholders change hashes, so a scrubbed
    // recording is replayed loosely (terminal state only) rather than branch for branch.
    exact: placeholders.length === before,
    input,
    status: run.status,
    outcome: run.outcome,
    output,
    nodeRuns,
  };
}

const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

export async function buildExportBundle(input: ExportBundleInput): Promise<ExportBundle> {
  WorkflowDefinitionSchema.parse(input.definition);
  const plan = ExecutionPlanSchema.parse(input.plan);
  const version = input.version === "draft" ? "draft" : `v${input.version}`;
  const root = `flowaid-${input.workflow.slug}-${version}`;
  const workflowTs = await generateWorkflowTs(input.definition, {
    title: `${input.workflow.name} (${version})`,
  });
  const hash = assertRoundTrip(input.definition, workflowTs);

  const closure = packageClosure(plan);
  const placeholders: Placeholder[] = [];
  const files = new Map<string, string | Uint8Array>();
  const vendored = input.mode === "vendored" ? vendorFiles(closure, input.vendor ?? []) : undefined;

  files.set("README.md", ""); // filled last (it lists the placeholders)
  files.set(
    "package.json",
    generatePackageJson(plan, {
      slug: input.workflow.slug,
      name: input.workflow.name,
      version: input.version,
      mode: input.mode,
      versions: input.versions ?? PACKAGE_VERSIONS,
      ...(vendored ? { vendorFiles: vendored } : {}),
    }),
  );
  files.set(".env.example", generateEnvExample(plan));
  files.set(".gitignore", "node_modules\n.env\n");
  files.set("tsconfig.json", generateTsconfig());
  files.set("workflow.json", json(input.definition));
  files.set("workflow.plan.json", json(plan));
  files.set("src/workflow.ts", workflowTs);
  files.set("src/flow.ts", generateFlow());
  files.set("src/nodes.ts", generateNodes(plan));
  files.set("src/providers.ts", generateProviders(plan));
  files.set("src/sandbox.ts", generateSandbox(plan));
  if (closure.includes("nodes-langchain")) files.set("src/langchain.ts", generateLangchain());
  files.set("src/run.ts", generateRunner());
  files.set("src/serve.ts", generateServe());
  files.set("src/client.ts", generateClient(input.workflow.id));
  files.set("src/validate.ts", generateValidate());
  files.set(
    "inputs/example.json",
    generateExampleInput(plan.inputs, input.sampleInput, placeholders),
  );
  for (const [path, content] of Object.entries(generateTests(plan, input.workflow.name)))
    files.set(path, content);
  if (input.recordedRun)
    files.set(
      "tests/recorded-run.json",
      json(recordedRunFile(input.recordedRun, plan, placeholders)),
    );
  files.set("Dockerfile", generateDockerfile());
  files.set("LICENSE", template("LICENSE"));
  files.set("NOTICE", generateNotice(input.workflow.name));

  if (vendored) {
    const sums: string[] = [];
    for (const file of Object.values(vendored).sort()) {
      const tarball = input.vendor?.find((f) => f.name === file);
      if (!tarball) continue;
      files.set(`vendor/${file}`, tarball.data);
      sums.push(`${createHash("sha256").update(tarball.data).digest("hex")}  ${file}`);
    }
    files.set("vendor/SHA256SUMS", `${sums.join("\n")}\n`);
    files.set("tests/vendor-integrity.test.ts", template("vendor-integrity.test.ts"));
  }

  files.set(
    "README.md",
    generateReadme({
      name: input.workflow.name,
      slug: input.workflow.slug,
      version: input.version,
      mode: input.mode,
      workflowId: input.workflow.id,
      plan,
      placeholders,
      hasRecordedRun: input.recordedRun !== undefined,
    }),
  );
  return new ExportBundle(root, files, placeholders, hash);
}
