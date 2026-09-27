/**
 * The files of an exported package besides `src/workflow.ts` (CODE_EXPORT.md §1, §3). Static
 * sources live in `templates/*.tmpl` (real TypeScript, kept out of this package's build); the
 * per-flow parts — provider wiring, node packages, the sandbox, package.json, README, .env.example,
 * the example input and the test fakes — are generated from the plan.
 */
import { readFileSync } from "node:fs";
import type { ExecutionPlan, JsonValue } from "@flowaid/workflow-core";
import { packageClosure, providerIds } from "./packageClosure.js";
import { sampleFor, scrub, type Placeholder } from "./placeholders.js";

/** Versions the generated package pins for its tooling. */
export const TOOLING_VERSIONS = {
  tsx: "4.23.15",
  vitest: "4.1.11",
  typescript: "5.9.3",
  "@types/node": "24.13.6",
} as const;

const templateCache = new Map<string, string>();
/** A static template (`templates/<name>.tmpl`). */
export function template(name: string): string {
  let text = templateCache.get(name);
  if (text === undefined) {
    text = readFileSync(new URL(`../templates/${name}.tmpl`, import.meta.url), "utf8");
    templateCache.set(name, text);
  }
  return text;
}

const fill = (text: string, values: Record<string, string>): string =>
  Object.entries(values).reduce((t, [k, v]) => t.split(k).join(v), text);

const DECISION_PROVIDERS = new Set(["typesafe"]);

/** `src/providers.ts`: a registry with the factories of every provider the plan's model refs name. */
export function generateProviders(plan: ExecutionPlan): string {
  const closure = new Set(packageClosure(plan));
  const imports: string[] = [];
  const registrations: string[] = [];
  if (closure.has("provider-typesafe")) {
    imports.push(`import { typesafeFactory } from "@flowaid/provider-typesafe";`);
    registrations.push("  registry.register(typesafeFactory());");
  }
  if (closure.has("provider-openai")) {
    imports.push(`import { openaiFactories } from "@flowaid/provider-openai";`);
    registrations.push("  for (const factory of openaiFactories()) registry.register(factory);");
  }
  if (closure.has("provider-anthropic")) {
    imports.push(`import { anthropicFactory } from "@flowaid/provider-anthropic";`);
    registrations.push("  registry.register(anthropicFactory());");
  }
  if (closure.has("provider-ollama")) {
    imports.push(
      `import { ollamaEmbeddingFactory, ollamaFactory } from "@flowaid/provider-ollama";`,
    );
    registrations.push(
      "  registry.register(ollamaFactory());",
      "  registry.register(ollamaEmbeddingFactory());",
    );
  }
  return [
    "/** The providers this workflow's model refs use; keys come from the secrets in `.env`. */",
    `import { DefaultModelCatalog, ProviderRegistry } from "@flowaid/providers";`,
    ...imports,
    "",
    "export function createProviders(): ProviderRegistry {",
    "  const registry = new ProviderRegistry({ catalog: new DefaultModelCatalog() });",
    ...registrations,
    "  return registry;",
    "}",
    "",
  ].join("\n");
}

/** `src/nodes.ts`: the node packages the plan's task nodes come from. */
export function generateNodes(plan: ExecutionPlan): string {
  const langchain = packageClosure(plan).includes("nodes-langchain");
  return [
    "/** The node packages this workflow's task nodes come from. */",
    `import type { NodePackage } from "@flowaid/node-sdk";`,
    `import { coreNodes } from "@flowaid/nodes-core";`,
    ...(langchain ? [`import { langchainNodes } from "./langchain.js";`] : []),
    "",
    `export const nodes: NodePackage[] = [coreNodes${langchain ? ", langchainNodes" : ""}];`,
    "",
  ].join("\n");
}

/** `src/langchain.ts` (only when the flow uses `langchain.*` nodes or `langchain:*` providers). */
export function generateLangchain(): string {
  return [
    "/** The LangChain node package (kept in its own module so the rest of the package stays LangChain-free). */",
    `import langchainNodes from "@flowaid/nodes-langchain";`,
    "",
    "export { langchainNodes };",
    "",
  ].join("\n");
}

/** `src/sandbox.ts`: the isolated-vm sandbox for `code`/`shell` nodes, when the flow has them. */
export function generateSandbox(plan: ExecutionPlan): string {
  if (!packageClosure(plan).includes("sandbox"))
    return [
      "/** This workflow has no code or shell nodes, so it needs no sandbox. */",
      `import type { SandboxExecutor } from "@flowaid/workflow-core";`,
      "",
      "export function createSandbox(): Promise<SandboxExecutor | undefined> {",
      "  return Promise.resolve(undefined);",
      "}",
      "",
    ].join("\n");
  return [
    "/**",
    " * The sandbox for `code` and `shell` nodes: isolated-vm when its native build is installed",
    " * (Node 24 prebuilds), otherwise none — such nodes then fail with SANDBOX_UNAVAILABLE.",
    " */",
    `import type { SandboxExecutor } from "@flowaid/workflow-core";`,
    "",
    "export async function createSandbox(): Promise<SandboxExecutor | undefined> {",
    "  try {",
    `    const { createSandbox: create } = await import("@flowaid/sandbox");`,
    `    return create("isolated-vm");`,
    "  } catch {",
    "    return undefined;",
    "  }",
    "}",
    "",
  ].join("\n");
}

export const generateFlow = (): string => template("flow.ts");
export const generateRunner = (): string => template("run.ts");
export const generateServe = (): string => template("serve.ts");
export const generateValidate = (): string => template("validate.ts");
export const generateClient = (workflowId: string): string =>
  fill(template("client.ts"), { __WORKFLOW_ID__: workflowId });

/** `tests/workflow.test.ts` and `tests/fakes.ts`. */
export function generateTests(plan: ExecutionPlan, name: string): Record<string, string> {
  const ids = providerIds(plan);
  const decision = ids.filter((id) => DECISION_PROVIDERS.has(id));
  const generation = ids.filter((id) => !DECISION_PROVIDERS.has(id) && !id.includes(":"));
  if (!decision.includes("typesafe")) decision.unshift("typesafe");
  return {
    "tests/workflow.test.ts": fill(template("workflow.test.ts"), {
      __WORKFLOW_NAME__: JSON.stringify(name),
    }),
    "tests/fakes.ts": fill(template("fakes.ts"), {
      __DECISION_PROVIDERS__: JSON.stringify(decision),
      __GENERATION_PROVIDERS__: JSON.stringify(generation),
    }),
  };
}

/** `.env.example`: one line per declared secret, then the server settings for `pnpm remote`. */
export function generateEnvExample(plan: ExecutionPlan): string {
  const lines = [
    "# Secrets this workflow declares (values are never exported). Copy to .env and fill in.",
  ];
  for (const s of plan.secrets) {
    lines.push(
      `# ${s.credentialType}${s.required ? "" : " (optional)"}${s.description ? ` — ${s.description}` : ""}`,
    );
    lines.push(`${s.name}=`);
  }
  if (plan.variables.length > 0) {
    lines.push("", "# Workflow variables and their defaults (set in the definition):");
    for (const v of plan.variables)
      lines.push(
        `#   ${v.name} (${v.source})${v.default === undefined ? "" : ` = ${JSON.stringify(v.default)}`}`,
      );
  }
  lines.push(
    "",
    "# pnpm remote: run on a FlowAId server instead of locally",
    "FLOWAID_BASE_URL=http://localhost:3001",
    "FLOWAID_API_KEY=",
    "# FLOWAID_ENVIRONMENT_ID=",
    "",
    "# pnpm serve",
    "PORT=8080",
    "",
  );
  return lines.join("\n");
}

/**
 * `inputs/example.json`: the sample run's input with pii/sensitive fields and redaction stubs
 * replaced (when a sample is given), else a value generated from the input schema.
 */
export function generateExampleInput(
  inputsSchema: unknown,
  sample: JsonValue | undefined,
  placeholders: Placeholder[],
): string {
  const value =
    sample === undefined
      ? sampleFor(inputsSchema)
      : scrub(sample, inputsSchema, "inputs/example.json#", placeholders);
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function generateDockerfile(): string {
  return [
    "# The workflow behind `pnpm serve` (POST /run, GET /runs/:id, GET /runs/:id/stream).",
    "FROM node:24-alpine",
    "WORKDIR /app",
    "RUN corepack enable",
    "COPY . .",
    "RUN pnpm install",
    "ENV NODE_ENV=production PORT=8080",
    "EXPOSE 8080",
    "USER node",
    `CMD ["pnpm", "serve"]`,
    "",
  ].join("\n");
}

export function generateTsconfig(): string {
  return `${JSON.stringify(
    {
      compilerOptions: {
        target: "ES2024",
        module: "NodeNext",
        moduleResolution: "NodeNext",
        strict: true,
        skipLibCheck: true,
        resolveJsonModule: true,
        noEmit: true,
        types: ["node"],
      },
      include: ["src", "tests"],
    },
    null,
    2,
  )}\n`;
}

export interface PackageJsonOptions {
  slug: string;
  name: string;
  version: number | "draft";
  mode: "npm" | "vendored";
  /** `@flowaid/<short>` → version, for npm mode. */
  versions: Readonly<Record<string, string>>;
  /** `@flowaid/<short>` → tarball file name in `vendor/`, for vendored mode. */
  vendorFiles?: Readonly<Record<string, string>>;
}

/** `package.json`: scripts `flow`, `serve`, `remote`, `validate`, `test`; runtime deps pinned. */
export function generatePackageJson(plan: ExecutionPlan, o: PackageJsonOptions): string {
  const deps: Record<string, string> = {};
  const overrides: Record<string, string> = {};
  for (const short of packageClosure(plan)) {
    const name = `@flowaid/${short}`;
    if (o.mode === "vendored") {
      const file = o.vendorFiles?.[short];
      if (!file) throw new Error(`vendored export: no tarball for ${name}`);
      overrides[name] = `file:./vendor/${file}`;
    } else {
      const version = o.versions[short];
      if (!version) throw new Error(`npm export: no version for ${name}`);
      overrides[name] = version;
    }
    deps[name] = overrides[name];
  }
  deps.tsx = TOOLING_VERSIONS.tsx;
  const pkg = {
    name: `flowaid-${o.slug}`,
    version: o.version === "draft" ? "0.0.0-draft" : `${o.version}.0.0`,
    private: true,
    description: `${o.name} — a FlowAId workflow as a runnable package.`,
    license: "Apache-2.0",
    type: "module",
    engines: { node: ">=24" },
    scripts: {
      flow: "tsx src/run.ts",
      serve: "tsx src/serve.ts",
      remote: "tsx src/client.ts",
      validate: "tsx src/validate.ts",
      test: "vitest run",
    },
    dependencies: deps,
    devDependencies: {
      "@types/node": TOOLING_VERSIONS["@types/node"],
      typescript: TOOLING_VERSIONS.typescript,
      vitest: TOOLING_VERSIONS.vitest,
    },
    // Every @flowaid package (the transitive ones too) resolves to the same pinned copy.
    pnpm: { overrides },
  };
  return `${JSON.stringify(pkg, null, 2)}\n`;
}

export interface ReadmeOptions {
  name: string;
  slug: string;
  version: number | "draft";
  mode: "npm" | "vendored";
  workflowId: string;
  plan: ExecutionPlan;
  placeholders: readonly Placeholder[];
  hasRecordedRun: boolean;
}

export function generateReadme(o: ReadmeOptions): string {
  const v = o.version === "draft" ? "draft" : `v${o.version}`;
  const secrets = o.plan.secrets.length
    ? o.plan.secrets
        .map((s) => `- \`${s.name}\` (${s.credentialType}${s.required ? "" : ", optional"})`)
        .join("\n")
    : "- none";
  const nodesOf = (kind: string) =>
    Object.values(o.plan.nodes).filter((n) => n.op.kind === "task" && n.op.type.startsWith(kind));
  const caveats: string[] = [];
  if (nodesOf("flowaid.tools.mcp").length > 0)
    caveats.push(
      "- MCP nodes call servers that a FlowAId workspace connects. Locally, pass `services.tools` to `runWorkflow` (see `src/flow.ts`) or run the flow on the server with `pnpm remote`.",
    );
  if (o.plan.subflows.length > 0)
    caveats.push(
      "- Subflow nodes run other workflows; export those too and pass them through `subflows` to `runWorkflow`, or use `pnpm remote`.",
    );
  if (Object.values(o.plan.nodes).some((n) => n.kind === "human"))
    caveats.push(
      "- Human nodes ask on the terminal under `pnpm flow`; `pnpm serve` leaves such runs `waiting_for_human`.",
    );
  const placeholders = o.placeholders.length
    ? [
        "## Placeholders",
        "",
        "These values were replaced by schema-generated placeholders because they are personal or sensitive data (or were already redacted on the server):",
        "",
        ...o.placeholders.map((p) => `- \`${p.location}\` (${p.reason})`),
        "",
      ]
    : [];
  return [
    `# ${o.name} (${v})`,
    "",
    `This package is the FlowAId workflow **${o.name}** as code. It runs without a FlowAId server: the embedded runtime executes the same plan, with the same events and accounting, as the server does.`,
    "",
    "## Quick start",
    "",
    "```sh",
    "pnpm install",
    "cp .env.example .env      # fill in the keys",
    "pnpm validate             # compiles src/workflow.ts",
    "pnpm test                 # fake providers, no network",
    "pnpm flow -- --input inputs/example.json",
    "```",
    "",
    "## Secrets",
    "",
    secrets,
    "",
    "## Other ways to run it",
    "",
    "- `pnpm serve` starts an HTTP API (`POST /run`, `GET /runs/:id`, `GET /runs/:id/stream` with Server-Sent Events) on `PORT` (default 8080). The `Dockerfile` runs the same.",
    `- \`pnpm remote\` runs it on a FlowAId server (\`FLOWAID_BASE_URL\`, \`FLOWAID_API_KEY\`); the workflow id is \`${o.workflowId}\`.`,
    '- In your own code: `import { runWorkflow } from "./src/flow.js"`.',
    "",
    "## Editing",
    "",
    "`src/workflow.ts` is the workflow written with the `@flowaid/workflow-sdk` builders. While it is unchanged, runs use `workflow.plan.json` (the plan the server compiled); after an edit they compile `src/workflow.ts` instead. To bring the change back, import `workflow.json` (or the output of `defineWorkflow`) in FlowAId under **Import**.",
    "",
    ...(caveats.length ? ["## Notes", "", ...caveats, ""] : []),
    ...placeholders,
    "## Files",
    "",
    "| Path | What |",
    "| --- | --- |",
    "| `workflow.json` | the workflow definition (secret names only) |",
    "| `workflow.plan.json` | the compiled plan |",
    "| `src/workflow.ts` | the same workflow as code |",
    "| `src/flow.ts` | runtime wiring: nodes, providers, sandbox, plan |",
    "| `src/run.ts` / `src/serve.ts` / `src/client.ts` | local runner, HTTP wrapper, server client |",
    "| `inputs/example.json` | a sample input |",
    "| `tests/` | Vitest suite on fake providers |",
    ...(o.mode === "vendored"
      ? ["| `vendor/` | the FlowAId runtime packages, with `SHA256SUMS` |"]
      : []),
    "",
    `Dependency mode: **${o.mode}**.${o.hasRecordedRun ? " `tests/recorded-run.json` holds a recorded run the tests replay." : ""}`,
    "",
    "Licensed under the Apache License 2.0 (see `LICENSE` and `NOTICE`).",
    "",
  ].join("\n");
}

export function generateNotice(name: string): string {
  return [
    `${name} — exported from FlowAId.`,
    "",
    "This package contains code generated by FlowAId and, in vendor/, the FlowAId runtime",
    "packages. FlowAId is licensed under the Apache License, Version 2.0 (see LICENSE).",
    "",
  ].join("\n");
}
