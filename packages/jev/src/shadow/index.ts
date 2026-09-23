/**
 * Shadow comparison (JEV_ENGINEERING.md §11.2; handbook §IX.D).
 *
 * In shadow mode a Jev contract is evaluated next to the existing production decision (an LLM
 * prompt, a rule, code or a person) and only a receipt is written: `actionTaken` is always false.
 * Agreement is NOT accuracy — the production path can be wrong — so summaries also report each
 * side's accuracy against human labels where they exist.
 */
import { z } from "zod";
import { NodeIdSchema } from "@flowaid/workflow-core";
import { ContractRefSchema, HashSchema, JevRouteSchema, type JevRoute } from "../wire.js";

export const ProductionSourceSchema = z.enum(["llm", "rule", "code", "human", "jev"]);
export type ProductionSource = z.infer<typeof ProductionSourceSchema>;

export const ShadowComparisonSchema = z.object({
  id: z.uuid(),
  receiptId: z.uuid(),
  contract: ContractRefSchema,
  runId: z.uuid(),
  nodeRunId: z.uuid(),
  question: z.string(),
  stateHash: HashSchema,
  jevModel: z.string(),
  shadow: z.object({
    outcome: z.string(),
    confidence: z.number(),
    distribution: z.record(z.string(), z.number()),
    wouldRoute: JevRouteSchema,
  }),
  production: z.object({
    source: ProductionSourceSchema,
    nodeId: NodeIdSchema,
    nodeRunId: z.uuid().nullable(),
    answer: z.string().nullable(),
    confidence: z.number().nullable(),
  }),
  agree: z.boolean().nullable(),
  humanLabel: z.string().nullable(),
  actionTaken: z.literal(false),
  deferred: z.boolean(),
  at: z.iso.datetime(),
});
export type ShadowComparison = z.infer<typeof ShadowComparisonSchema>;

/**
 * Maps a free-form production answer into the contract's outcome space: exact key, then
 * case/whitespace-insensitive key, then a declared alias. `null` when it cannot be mapped.
 */
export function mapProductionAnswer(
  answer: string | null,
  outcomes: readonly string[],
  aliases: Readonly<Record<string, string>> = {},
): string | null {
  if (answer === null) return null;
  if (outcomes.includes(answer)) return answer;
  const norm = (s: string): string =>
    s
      .trim()
      .toLowerCase()
      .replace(/[\s-]+/g, "_");
  const n = norm(answer);
  const direct = outcomes.find((o) => norm(o) === n);
  if (direct !== undefined) return direct;
  for (const [alias, key] of Object.entries(aliases)) {
    if (norm(alias) === n && outcomes.includes(key)) return key;
  }
  return null;
}

export interface CompareShadowInput {
  id: string;
  receiptId: string;
  contract: ShadowComparison["contract"];
  runId: string;
  nodeRunId: string;
  question: string;
  stateHash: string;
  jevModel: string;
  shadow: {
    outcome: string;
    confidence: number;
    distribution: Record<string, number>;
    wouldRoute: JevRoute;
  };
  production: {
    source: ProductionSource;
    nodeId: string;
    nodeRunId: string | null;
    rawAnswer: string | null;
    confidence: number | null;
  };
  outcomes: readonly string[];
  aliases?: Readonly<Record<string, string>>;
  humanLabel?: string | null;
  deferred?: boolean;
  at: string;
}

/** Builds a validated shadow record; `agree` is null when the production answer is not mappable. */
export function compareShadow(input: CompareShadowInput): ShadowComparison {
  const answer = mapProductionAnswer(input.production.rawAnswer, input.outcomes, input.aliases);
  return ShadowComparisonSchema.parse({
    id: input.id,
    receiptId: input.receiptId,
    contract: input.contract,
    runId: input.runId,
    nodeRunId: input.nodeRunId,
    question: input.question,
    stateHash: input.stateHash,
    jevModel: input.jevModel,
    shadow: input.shadow,
    production: {
      source: input.production.source,
      nodeId: input.production.nodeId,
      nodeRunId: input.production.nodeRunId,
      answer,
      confidence: input.production.confidence,
    },
    agree: answer === null ? null : answer === input.shadow.outcome,
    humanLabel: input.humanLabel ?? null,
    actionTaken: false,
    deferred: input.deferred ?? false,
    at: input.at,
  });
}

export interface ShadowSummary {
  total: number;
  comparable: number;
  unmappable: number;
  /** Agreement over comparable records; `null` when none are comparable. */
  agreement: number | null;
  /** Rows = production answer, columns = shadow outcome. */
  confusion: { labels: string[]; matrix: number[][] };
  /** Accuracy against human labels where labeled; agreement alone never completes a rollout. */
  vsHuman: { labeled: number; shadowAccuracy: number | null; productionAccuracy: number | null };
  /** Would-route shares of the shadow side. */
  wouldRoute: Record<JevRoute, number>;
  /** Records where the two sides disagreed (the `shadow_disagreement` labeling stratum). */
  disagreements: string[];
}

/** Summarises shadow records for one contract version and window. */
export function summarizeShadow(records: readonly ShadowComparison[]): ShadowSummary {
  const comparable = records.filter((r) => r.agree !== null);
  const labels = [
    ...new Set(
      records.flatMap((r) => [
        r.shadow.outcome,
        ...(r.production.answer === null ? [] : [r.production.answer]),
      ]),
    ),
  ].sort();
  const index = new Map(labels.map((l, i) => [l, i]));
  const matrix = labels.map(() => labels.map(() => 0));
  for (const r of comparable) {
    const i = r.production.answer === null ? undefined : index.get(r.production.answer);
    const j = index.get(r.shadow.outcome);
    if (i === undefined || j === undefined) continue;
    const row = matrix[i];
    if (row !== undefined) row[j] = (row[j] ?? 0) + 1;
  }
  const labeled = records.filter((r) => r.humanLabel !== null);
  const acc = (pick: (r: ShadowComparison) => string | null): number | null =>
    labeled.length === 0
      ? null
      : labeled.filter((r) => pick(r) === r.humanLabel).length / labeled.length;
  const routeCount = (route: JevRoute): number =>
    records.length === 0
      ? 0
      : records.filter((r) => r.shadow.wouldRoute === route).length / records.length;
  return {
    total: records.length,
    comparable: comparable.length,
    unmappable: records.length - comparable.length,
    agreement:
      comparable.length === 0
        ? null
        : comparable.filter((r) => r.agree === true).length / comparable.length,
    confusion: { labels, matrix },
    vsHuman: {
      labeled: labeled.length,
      shadowAccuracy: acc((r) => r.shadow.outcome),
      productionAccuracy: acc((r) => r.production.answer),
    },
    wouldRoute: {
      auto: routeCount("auto"),
      improve: routeCount("improve"),
      human: routeCount("human"),
    },
    disagreements: comparable.filter((r) => r.agree === false).map((r) => r.id),
  };
}
