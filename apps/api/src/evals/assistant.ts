/**
 * `pnpm eval:assistant`: runs the Ask FlowAId evaluation set (@flowaid/advisor, fixture
 * workspace) against a live generation model and prints a Markdown report
 * (docs/FLOWAID_AI_EVALUATION.md). Nothing touches a database; the questions go to the model.
 *
 *   ANTHROPIC_API_KEY=… pnpm eval:assistant                      # claude-sonnet-5
 *   OPENAI_API_KEY=… pnpm eval:assistant -- --provider openai    # gpt-5.5
 *   pnpm eval:assistant -- --provider ollama --model qwen3:8b     # local Ollama
 *   … --repeat 3 --json report.json --min-pass 0.85
 *
 * Exits 1 when the pass rate is below `--min-pass` (default 0), so a CI job can gate on it.
 */
import { writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { formatEvalReport, runAssistantEval, type EvalReport } from "@flowaid/advisor";
import { anthropicFactory } from "@flowaid/provider-anthropic";
import { ollamaFactory } from "@flowaid/provider-ollama";
import { openaiFactory } from "@flowaid/provider-openai";
import { DefaultModelCatalog, createSafeFetch } from "@flowaid/providers";
import type { GenerationProvider, ProviderFactory } from "@flowaid/workflow-core";
import { uuidv7 } from "@flowaid/shared";

const PROVIDERS: Record<
  string,
  {
    factory: () => ProviderFactory<GenerationProvider>;
    model: string;
    credential: () => Record<string, string> | undefined;
  }
> = {
  anthropic: {
    factory: anthropicFactory,
    model: "claude-sonnet-5",
    credential: () =>
      process.env.ANTHROPIC_API_KEY ? { apiKey: process.env.ANTHROPIC_API_KEY } : undefined,
  },
  openai: {
    factory: openaiFactory,
    model: "gpt-5.5",
    credential: () =>
      process.env.OPENAI_API_KEY ? { apiKey: process.env.OPENAI_API_KEY } : undefined,
  },
  ollama: {
    factory: ollamaFactory,
    model: "qwen3:8b",
    credential: () => (process.env.OLLAMA_HOST ? { host: process.env.OLLAMA_HOST } : undefined),
  },
};

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      provider: { type: "string" },
      model: { type: "string" },
      repeat: { type: "string", default: "1" },
      json: { type: "string" },
      "min-pass": { type: "string", default: "0" },
    },
  });
  const name =
    values.provider ??
    (process.env.ANTHROPIC_API_KEY
      ? "anthropic"
      : process.env.OPENAI_API_KEY
        ? "openai"
        : "ollama");
  const p = PROVIDERS[name];
  if (!p) {
    console.error(`unknown --provider ${name}: use ${Object.keys(PROVIDERS).join(", ")}`);
    return 2;
  }
  const credential = p.credential();
  if (!credential && name !== "ollama") {
    console.error(
      `set ${name === "anthropic" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY"} to evaluate ${name}, or pass --provider ollama`,
    );
    return 2;
  }
  const model = values.model ?? p.model;
  const catalog = new DefaultModelCatalog();
  // The questions go to a model provider, which is public (or Ollama on this computer).
  const http = createSafeFetch({
    timeoutMs: 120_000,
    userAgent: "FlowAId-Eval/1",
    allowPrivate: name === "ollama",
  });
  const provider = p.factory().create({ model, credential, http, catalog });
  const generate: Parameters<typeof runAssistantEval>[0] = (req) =>
    provider.generate(req, {
      signal: AbortSignal.timeout(180_000),
      runId: "eval",
      nodeRunId: uuidv7(),
      idempotencyKey: null,
    });

  const repeat = Math.max(1, Number(values.repeat) || 1);
  const reports: EvalReport[] = [];
  for (let i = 0; i < repeat; i++) {
    const r = await runAssistantEval(generate);
    reports.push(r);
    console.log(formatEvalReport(r, `${name}/${model}${repeat > 1 ? ` (run ${i + 1})` : ""}`));
    console.log("");
  }
  const passRates = reports.map((r) => r.passRate);
  const mean = passRates.reduce((a, b) => a + b, 0) / passRates.length;
  if (repeat > 1)
    console.log(
      `Mean pass rate over ${repeat} runs: ${(mean * 100).toFixed(1)}% (min ${(Math.min(...passRates) * 100).toFixed(0)}%, max ${(Math.max(...passRates) * 100).toFixed(0)}%)`,
    );
  if (values.json)
    writeFileSync(values.json, JSON.stringify({ provider: name, model, runs: reports }, null, 2));
  return mean >= Number(values["min-pass"]) ? 0 : 1;
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(2);
  },
);
