/**
 * The `create-flowaid-node` scaffold (ARCHITECTURE.md §3.5): a publishable FlowAId node package
 * with a `defineNode` example, a harness test, a manifest check, the `flowaid-node` keyword and
 * the `flowaid` package.json field. `scaffold()` is pure (path → content); `main.ts` writes it.
 */
import { z } from "zod";
import { defineNode, ok, toManifest, type AnyNodeDefinition } from "@flowaid/node-sdk";

/** The node SDK range generated packages declare (this platform's SDK major/minor). */
export const SDK_RANGE = "^0.1.0";
const SDK_VERSION = "0.1.0";

export interface ScaffoldOptions {
  /** npm package name, e.g. `@acme/nodes-crm` or `flowaid-node-weather` */
  name: string;
  description?: string;
  author?: string;
}

const NAME_RE = /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/;

export function validateName(name: string): string | null {
  if (!NAME_RE.test(name) || name.length > 214) return `"${name}" is not an npm package name`;
  if (name.startsWith("@flowaid/")) return "the @flowaid scope is reserved for the platform";
  return null;
}

/**
 * The example node, built in memory exactly as `src/index.ts` declares it, so the scaffold can
 * ship its manifest without compiling the package (the generated test keeps the two in sync).
 */
export function exampleNode(name: string): AnyNodeDefinition {
  return defineNode({
    id: `${name}.greet`,
    version: "1.0.0",
    metadata: {
      name: "Greet",
      description: "Greets someone by name. Replace it with your own node.",
      category: "data",
      icon: "hand",
      tags: ["example"],
      summary: "{{ config.greeting }}",
    },
    configSchema: z.strictObject({
      greeting: z.string().min(1).max(200).default("Hello"),
    }),
    inputSchema: z.object({ name: z.string().min(1) }),
    outputSchema: z.object({ text: z.string() }),
    capabilities: [],
    idempotency: "safe",
    execute: (ctx, input) =>
      Promise.resolve(ok({ text: `${ctx.config.greeting}, ${input.name}!` })),
  });
}

const indexTs = (name: string) => `/**
 * ${name}: FlowAId nodes. Every node type id starts with the package name ("${name}.").
 * After changing a node: \`npm run manifest\` (writes manifest.json), \`npm test\`.
 */
import { z } from "zod";
import { defineNode, definePackage, ok } from "@flowaid/node-sdk";

export const greetNode = defineNode({
  id: "${name}.greet",
  version: "1.0.0",
  metadata: {
    name: "Greet",
    description: "Greets someone by name. Replace it with your own node.",
    category: "data",
    icon: "hand",
    tags: ["example"],
    summary: "{{ config.greeting }}",
  },
  configSchema: z.strictObject({
    greeting: z.string().min(1).max(200).default("Hello"),
  }),
  inputSchema: z.object({ name: z.string().min(1) }),
  outputSchema: z.object({ text: z.string() }),
  capabilities: [],
  idempotency: "safe",
  execute: (ctx, input) => Promise.resolve(ok({ text: \`\${ctx.config.greeting}, \${input.name}!\` })),
});

/** What the platform loads (package.json "flowaid.package"). */
export const nodePackage = definePackage({
  name: "${name}",
  version: "0.1.0",
  sdk: "${SDK_RANGE}",
  nodes: [greetNode],
});
`;

const testTs = `import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { toManifest } from "@flowaid/node-sdk";
import { runNode } from "@flowaid/node-sdk/testing";
import { greetNode, nodePackage } from "./index.js";

describe("greet", () => {
  it("greets with the configured greeting", async () => {
    const { result } = await runNode(greetNode, { config: { greeting: "Hi" }, input: { name: "Ada" } });
    expect(result).toEqual({ kind: "ok", output: { text: "Hi, Ada!" } });
  });

  it("rejects a missing name", async () => {
    const { result } = await runNode(greetNode, { input: {} });
    expect(result.kind).toBe("error");
  });
});

describe("manifest.json", () => {
  it("is current (run \`npm run manifest\` after changing a node)", () => {
    const shipped = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url), "utf8")) as unknown;
    expect(shipped).toEqual({ nodes: nodePackage.nodes.map((n) => toManifest(n)) });
  });
});
`;

const manifestScript = `/** Writes manifest.json: the node manifests the platform reads without loading your code. */
import { writeFileSync } from "node:fs";
import { toManifest } from "@flowaid/node-sdk";
import { nodePackage } from "../src/index.js";

writeFileSync(
  new URL("../manifest.json", import.meta.url),
  \`\${JSON.stringify({ nodes: nodePackage.nodes.map((n) => toManifest(n)) }, null, 2)}\\n\`,
);
`;

export function scaffold(o: ScaffoldOptions): Record<string, string> {
  const problem = validateName(o.name);
  if (problem) throw new Error(problem);
  const packageJson = {
    name: o.name,
    version: "0.1.0",
    description: o.description ?? "FlowAId nodes",
    ...(o.author ? { author: o.author } : {}),
    license: "Apache-2.0",
    type: "module",
    keywords: ["flowaid-node", "flowaid"],
    flowaid: { package: "nodePackage", sdk: SDK_RANGE, manifest: "manifest.json" },
    main: "./dist/index.js",
    types: "./dist/index.d.ts",
    exports: { ".": { types: "./dist/index.d.ts", default: "./dist/index.js" } },
    files: ["dist", "manifest.json", "README.md"],
    scripts: {
      build: "tsc -p tsconfig.json",
      manifest: "tsx scripts/manifest.ts",
      test: "vitest run",
      prepublishOnly: "npm run build && npm run manifest && npm test",
    },
    peerDependencies: { "@flowaid/node-sdk": SDK_RANGE },
    dependencies: { zod: "^4.6.5" },
    devDependencies: {
      "@flowaid/node-sdk": SDK_RANGE,
      tsx: "^4.23.0",
      typescript: "^5.9.3",
      vitest: "^4.1.11",
    },
    engines: { node: ">=24" },
  };
  const manifest = { nodes: [toManifest(exampleNode(o.name))] };
  return {
    "package.json": `${JSON.stringify(packageJson, null, 2)}\n`,
    "tsconfig.json": `${JSON.stringify(
      {
        compilerOptions: {
          target: "ES2023",
          module: "NodeNext",
          moduleResolution: "NodeNext",
          strict: true,
          declaration: true,
          outDir: "dist",
          rootDir: "src",
          skipLibCheck: true,
        },
        include: ["src"],
        exclude: ["src/**/*.test.ts"],
      },
      null,
      2,
    )}\n`,
    "src/index.ts": indexTs(o.name),
    "src/index.test.ts": testTs,
    "scripts/manifest.ts": manifestScript,
    "manifest.json": `${JSON.stringify(manifest, null, 2)}\n`,
    ".gitignore": "node_modules\ndist\n",
    "README.md": `# ${o.name}

${o.description ?? "FlowAId nodes"}.

\`\`\`sh
npm install
npm test
npm run manifest   # after changing a node: writes manifest.json
\`\`\`

Install it on a FlowAId server (the package must be on the server's allow-list,
\`FLOWAID_PLUGIN_ALLOWED_SCOPES\`):

\`\`\`sh
flowaid plugin add ${o.name}
\`\`\`

Before publishing, go through the [publishing checklist](https://github.com/MoRohn/flowaid/blob/main/docs/plugins/publishing.md).
Built against the FlowAId node SDK ${SDK_VERSION}.
`,
  };
}
