/**
 * The embedded runtime behind `flowaid workflow run --local` and `flowaid validate`: the core
 * node package, the provider-* factories and (when isolated-vm is installed) the sandbox, wired
 * into `runLocally()` / the compiler without any server.
 */
import { join } from "node:path";
import { coreNodes } from "@flowaid/nodes-core";
import { DefaultModelCatalog, ProviderRegistry } from "@flowaid/providers";
import { anthropicFactory } from "@flowaid/provider-anthropic";
import { ollamaEmbeddingFactory, ollamaFactory } from "@flowaid/provider-ollama";
import { openaiFactories } from "@flowaid/provider-openai";
import { typesafeFactory } from "@flowaid/provider-typesafe";
import { createSandbox } from "@flowaid/sandbox";
import { COMPILER_VERSION, compile } from "@flowaid/workflow-compiler";
import type { Diagnostic, SandboxExecutor } from "@flowaid/workflow-core";
import { catalogOfPackages } from "@flowaid/workflow-runtime";
import type { CliIO } from "./io.js";
import { readValue } from "./values.js";

export function localProviders(): ProviderRegistry {
  const registry = new ProviderRegistry({ catalog: new DefaultModelCatalog() });
  registry.register(typesafeFactory());
  for (const f of openaiFactories()) registry.register(f);
  registry.register(anthropicFactory());
  registry.register(ollamaFactory());
  registry.register(ollamaEmbeddingFactory());
  return registry;
}

/**
 * The sandbox for `code`/`shell` nodes. isolated-vm (an optional dependency of @flowaid/sandbox)
 * loads on first use; where it is not installed those nodes fail with a clear error.
 */
export function localSandbox(): SandboxExecutor {
  return createSandbox("isolated-vm");
}

/** A definition from a `.json`/`.yaml` file, or `workflow.json` in a directory (an exported package). */
export async function loadDefinition(io: CliIO, path: string): Promise<unknown> {
  const file = /\.(json|ya?ml)$/i.test(path) ? path : join(path, "workflow.json");
  return readValue(io, `@${file}`);
}

export const localNodes = [coreNodes] as const;

/** Compiles with the bundled core nodes; `level: 'publish'` also reports what blocks a publish. */
export function compileLocally(
  definition: unknown,
  level: "draft" | "publish" = "publish",
): { ok: boolean; diagnostics: Diagnostic[]; planHash?: string } {
  const result = compile(definition, {
    catalog: catalogOfPackages(localNodes),
    level,
    compilerVersion: COMPILER_VERSION,
  });
  return result.ok
    ? { ok: true, diagnostics: result.diagnostics, planHash: result.plan.planHash }
    : { ok: false, diagnostics: result.diagnostics };
}

/** `NAME=value` pairs from `--secret`, then the environment for every declared secret. */
export function localSecrets(
  io: CliIO,
  definition: unknown,
  flags: readonly string[] = [],
): Record<string, string> {
  const out: Record<string, string> = {};
  const declared = (definition as { secrets?: { name: string }[] }).secrets ?? [];
  for (const { name } of declared) {
    const value = io.env[name];
    if (value) out[name] = value;
  }
  for (const pair of flags) {
    const eq = pair.indexOf("=");
    if (eq <= 0) throw new Error(`--secret expects NAME=value (got '${pair}')`);
    out[pair.slice(0, eq)] = pair.slice(eq + 1);
  }
  return out;
}
