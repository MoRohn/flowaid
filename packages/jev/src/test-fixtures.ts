/**
 * Test-only helpers: load the decision contracts shipped with the harness templates.
 * Not exported from the package index (it reads files through node:fs).
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ChoiceDecision, BooleanDecision, ScoreDecision } from "@flowaid/workflow-core";
import { parseContract, type DecisionContractBody } from "./contract.js";

const TEMPLATES = join(dirname(fileURLToPath(import.meta.url)), "..", "templates");

interface ContractsFile {
  decisionContracts: Array<{ key: string; body: unknown }>;
}

function isContractsFile(v: unknown): v is ContractsFile {
  return (
    typeof v === "object" &&
    v !== null &&
    Array.isArray((v as { decisionContracts?: unknown }).decisionContracts)
  );
}

/** Every contract body in `templates/*.contracts.json`, raw (unparsed) with its file name. */
export function rawTemplateContracts(): Array<{ file: string; body: unknown }> {
  const out: Array<{ file: string; body: unknown }> = [];
  for (const file of readdirSync(TEMPLATES)
    .filter((f) => f.endsWith(".contracts.json"))
    .sort()) {
    const parsed: unknown = JSON.parse(readFileSync(join(TEMPLATES, file), "utf8"));
    if (!isContractsFile(parsed)) throw new Error(`${file}: no decisionContracts array`);
    for (const c of parsed.decisionContracts) out.push({ file, body: c.body });
  }
  return out;
}

/** Parsed template contract by key (first match). */
export function templateContract(key: string): DecisionContractBody {
  const hit = rawTemplateContracts().find(
    (c) =>
      typeof c.body === "object" && c.body !== null && (c.body as { key?: unknown }).key === key,
  );
  if (hit === undefined) throw new Error(`no template contract ${key}`);
  return parseContract(hit.body);
}

const base = {
  provider: "typesafe",
  model: "jev-1.13.0",
  latencyMs: 84,
  costUsd: 0.00002,
  attempts: [],
} as const;

export function choiceDecision(probabilities: Record<string, number>): ChoiceDecision {
  const entries = Object.entries(probabilities).sort((a, b) => b[1] - a[1]);
  const top = entries[0];
  if (top === undefined) throw new Error("empty distribution");
  return {
    ...base,
    attempts: [],
    kind: "choice",
    value: top[0],
    probabilities,
    confidence: top[1],
  };
}

export function booleanDecision(pYes: number): BooleanDecision {
  return {
    ...base,
    attempts: [],
    kind: "boolean",
    value: pYes >= 0.5,
    pYes,
    probabilities: { true: pYes, false: 1 - pYes },
    confidence: Math.max(pYes, 1 - pYes),
  };
}

export function scoreDecision(levels: string[], probabilities: number[]): ScoreDecision {
  const value = probabilities.reduce((s, p, i) => s + p * i, 0);
  const level = Math.round(value);
  return {
    ...base,
    attempts: [],
    kind: "score",
    value,
    normalized: value / (levels.length - 1),
    level,
    levelLabel: levels[level] ?? "",
    levels,
    probabilities: Object.fromEntries(probabilities.map((p, i) => [String(i), p])),
    confidence: Math.max(...probabilities),
  };
}
