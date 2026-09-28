/**
 * PageIndex nodes (RFC-0022): `pageindex.index` builds (or reuses) a document's hierarchical index
 * and waits for it durably; `pageindex.retrieve` answers a query by navigating the section trees of
 * the documents in its scope with TypeSafe choice decisions and reading the chosen pages;
 * `pageindex.cite` checks an answer's [E1]-style citations against that evidence.
 *
 * Scope: a node's `scope` is its allowlist; `ctx.documents` binds the run's workspace. Ids outside
 * the scope are refused before any lookup reaches the host, and what the host returns is filtered
 * through the scope again.
 */
import { z } from "zod";
import { wrapUntrusted } from "@flowaid/shared";
import { defineNode, ok, suspend, type ExecutionContext } from "@flowaid/node-sdk";
import { HumanFallbackSignal } from "@flowaid/providers";
import {
  DEFAULT_BUDGET,
  checkCitations,
  evidenceForPrompt,
  retrieveEvidence,
  type SupportCheck,
  type SupportJudge,
} from "@flowaid/pageindex";
import {
  BadRequestError,
  NodeExecutionError,
  TimeoutError,
  type DecisionResult,
  type Evidence,
  type IndexReference,
  type JsonValue,
  type ProviderHop,
} from "@flowaid/workflow-core";
import { callCtx, usageSchema } from "../common.js";
import {
  activitySchema,
  checkSignal,
  citationSchema,
  decisionChainSchema,
  documentScopeSchema,
  documentsOf,
  evidenceSchema,
  indexReferenceSchema,
  navigatorFor,
  resolveScoped,
} from "./documents.js";

/** Index states that are still being worked on. */
const BUILDING = new Set<IndexReference["state"]>(["queued", "running", "cancel_requested"]);
const MINUTE = 60_000;

/** The event the worker delivers when a build ends (payload `{ indexId, state }`). */
export const indexEventName = (indexId: string) => `pageindex.index.${indexId}`;

interface IndexWaitState {
  indexId: string;
  created: boolean;
  /** epoch ms after which waiting fails with TIMEOUT */
  deadline: number;
}
const isWaitState = (v: unknown): v is IndexWaitState =>
  typeof v === "object" &&
  v !== null &&
  typeof (v as { indexId?: unknown }).indexId === "string" &&
  typeof (v as { deadline?: unknown }).deadline === "number";

function notReady(ref: IndexReference): NodeExecutionError {
  const why = ref.error ? `${ref.error.code}: ${ref.error.message}` : `the index is ${ref.state}`;
  return new NodeExecutionError(`Indexing ${ref.displayName} did not finish (${why})`, false, {
    indexId: ref.indexId,
    state: ref.state,
    ...(ref.error ? { error: ref.error } : {}),
  });
}

export const pageindexIndexNode = defineNode({
  id: "flowaid.pageindex.index",
  version: "1.0.0",
  metadata: {
    name: "PageIndex: Index document",
    description:
      "Builds the hierarchical page index of a document's latest version (or reuses an equivalent one) and waits until it is ready; the run pauses durably while the index is built. Outputs only a ready index.",
    category: "retrieval",
    icon: "file-search",
    tags: ["pageindex", "documents", "pdf", "index"],
    summary: "index {{ config.documentId }}",
  },
  configSchema: z.strictObject({
    documentId: z.uuid().meta({ "x-ui": { help: "The document to index (from Knowledge)." } }),
    timeoutMs: z
      .int()
      .min(MINUTE)
      .max(24 * 60 * MINUTE)
      .default(30 * MINUTE)
      .meta({
        "x-ui": {
          help: "How long to wait for the build. On timeout the node fails; indexing continues in the background.",
        },
      }),
  }),
  inputSchema: z.object({}),
  outputSchema: z.object({
    index: indexReferenceSchema.meta({ "x-port": { description: "The ready index." } }),
    reused: z.boolean().meta({
      "x-port": { description: "An equivalent index already existed or was being built." },
    }),
  }),
  capabilities: ["documents", "suspend"],
  idempotency: "safe",
  defaultPolicy: { timeoutMs: 60_000 },
  execute: async (ctx) => {
    const docs = documentsOf(ctx);
    const now = ctx.clock.now().getTime();
    const settle = (ref: IndexReference, created: boolean, deadline: number) => {
      if (ref.state === "ready") return ok({ index: ref, reused: !created });
      if (!BUILDING.has(ref.state)) throw notReady(ref);
      const left = deadline - now;
      if (left <= 0) throw timedOut(ref.displayName);
      const state: JsonValue = { indexId: ref.indexId, created, deadline };
      return suspend<never>(
        { kind: "event", eventName: indexEventName(ref.indexId), timeoutMs: left },
        state,
      );
    };
    const timedOut = (name: string) =>
      new TimeoutError(
        `${name} was not indexed within ${Math.round(ctx.config.timeoutMs / MINUTE)} min; indexing continues in the background, run again once it is ready`,
      );

    const resume = ctx.resume;
    if (resume) {
      if (!isWaitState(resume.state))
        throw new NodeExecutionError("the index wait state is missing or invalid", false);
      const saved = resume.state;
      if (resume.kind === "human")
        throw new NodeExecutionError("unexpected resume (human) of an index wait", false);
      checkSignal(ctx.signal);
      // the event payload names the ending state; the index itself is the authority
      const ref = await docs.getIndex(saved.indexId);
      if (resume.kind === "timeout" && ref.state !== "ready") throw timedOut(ref.displayName);
      return settle(ref, saved.created, saved.deadline);
    }
    checkSignal(ctx.signal);
    const r = await docs.requestIndex(ctx.config.documentId);
    return settle(r.index, r.created, now + ctx.config.timeoutMs);
  },
});

const budgetSchema = z
  .strictObject({
    maxSections: z.int().min(1).max(12).optional(),
    maxPages: z.int().min(1).max(40).optional(),
    maxDecisions: z.int().min(1).max(60).optional(),
  })
  .default({})
  .meta({
    "x-ui": {
      help: `Limits of one retrieval: evidence items (default ${DEFAULT_BUDGET.maxSections}), pages read (default ${DEFAULT_BUDGET.maxPages}) and section choices (default ${DEFAULT_BUDGET.maxDecisions}).`,
    },
  });

/** The evidence as a numbered, delimited block for an answer prompt (document text is data). */
export function promptContext(evidence: readonly Evidence[]): string {
  if (!evidence.length) return "";
  return wrapUntrusted(evidenceForPrompt(evidence), {
    label: "document evidence",
    maxBytes: 200_000,
  });
}

export const pageindexRetrieveNode = defineNode({
  id: "flowaid.pageindex.retrieve",
  version: "1.0.0",
  metadata: {
    name: "PageIndex: Retrieve evidence",
    description:
      "Finds the passages that answer a query by navigating the section trees of the documents in scope with TypeSafe choice decisions, then reads the chosen pages. Every excerpt is real page text with its document version and physical page; `prompt_context` numbers them [E1], [E2]… for an answer prompt.",
    category: "retrieval",
    icon: "book-open-text",
    tags: ["pageindex", "documents", "retrieval", "rag", "typesafe", "citations"],
  },
  configSchema: z.strictObject({
    scope: documentScopeSchema,
    budget: budgetSchema,
    decisionChain: decisionChainSchema,
  }),
  inputSchema: z.object({
    query: z.string().min(1).max(4000),
    index_ids: z
      .array(z.uuid())
      .max(20)
      .optional()
      .meta({
        "x-port": {
          description:
            "Pins exact index versions (e.g. a previous retrieval's index_ids); each must be in the scope.",
        },
      }),
  }),
  outputSchema: z.object({
    evidence: z.array(evidenceSchema).max(12),
    status: z.enum(["complete", "partial", "empty"]),
    warnings: z.array(z.string()),
    activity: activitySchema,
    usage: usageSchema.nullable(),
    cost_usd: z.number().min(0),
    index_ids: z.array(z.string()).meta({
      "x-port": { description: "The indexes read; pin them to repeat on the same versions." },
    }),
    prompt_context: z.string().meta({
      "x-port": { description: "The evidence numbered [E1]… as delimited document text." },
    }),
  }),
  credentials: [
    {
      name: "typesafe",
      types: ["typesafe.api_key"],
      required: false,
      description:
        "TypeSafe API key for the section choices (else the workspace's decision chain).",
    },
  ],
  capabilities: ["documents", "decision", "credentials"],
  idempotency: "safe",
  defaultPolicy: { timeoutMs: 180_000 },
  execute: async (ctx, input) => {
    const c = ctx.config;
    const docs = documentsOf(ctx);
    const { indexes, warnings } = await resolveScoped(ctx, c.scope, input.index_ids ?? []);
    if (indexes.length === 0) {
      return ok({
        evidence: [],
        status: "empty" as const,
        warnings: [
          ...warnings,
          "no document in this node's scope has a ready index (index the documents first, e.g. with PageIndex: Index document)",
        ],
        activity: { documents: 0, sectionsInspected: 0, pagesRead: 0, decisions: 0, elapsedMs: 0 },
        usage: null,
        cost_usd: 0,
        index_ids: [],
        prompt_context: "",
      });
    }
    if (indexes.length > DEFAULT_BUDGET.maxDocuments)
      throw new BadRequestError(
        `the scope resolves to ${indexes.length} documents; one retrieval covers at most ${DEFAULT_BUDGET.maxDocuments}: narrow the scope or pin index_ids`,
      );
    const result = await retrieveEvidence({
      query: input.query,
      indexes,
      outline: (id) => {
        checkSignal(ctx.signal);
        return docs.outline(id);
      },
      readPages: (id, pages) => {
        checkSignal(ctx.signal);
        return docs.readPages(id, pages);
      },
      navigate: navigatorFor(ctx, c.decisionChain),
      budget: c.budget,
      now: () => ctx.clock.now().getTime(),
    });
    return ok(
      {
        evidence: result.evidence,
        status: result.status,
        warnings: [...warnings, ...result.warnings],
        activity: result.activity,
        usage: result.usage,
        cost_usd: result.costUsd,
        index_ids: indexes.map((i) => i.indexId),
        prompt_context: promptContext(result.evidence),
      },
      { ...(result.usage ? { usage: result.usage } : {}), costUsd: result.costUsd },
    );
  },
});

/** Support checks per answer; the rest stay unchecked and the answer at most `partial`. */
export const MAX_SUPPORT_CHECKS = 20;
const CLAIM_CHARS = 1500;

/**
 * A judge over the decision chain: one boolean question per claim, with the cited excerpt as the
 * state. Claims citing the same excerpt go in one batch when the provider batches.
 */
function decisionJudge(
  ctx: ExecutionContext<unknown>,
  chain: readonly ProviderHop[] | undefined,
  spent: DecisionResult[],
): SupportJudge {
  const provider = ctx.providers.decision(chain ?? []);
  const question = (claim: string) => ({
    kind: "boolean" as const,
    instructions: `Does the text fully support this statement? Statement: ${claim.slice(0, CLAIM_CHARS)}`,
  });
  return async (checks: SupportCheck[]) => {
    const out: { id: string; supported: boolean; score: number }[] = [];
    const groups = new Map<string, SupportCheck[]>();
    for (const c of checks.slice(0, MAX_SUPPORT_CHECKS))
      groups.set(c.evidence.id, [...(groups.get(c.evidence.id) ?? []), c]);
    try {
      for (const group of groups.values()) {
        checkSignal(ctx.signal);
        const state = group[0]?.evidence.excerpt ?? "";
        let answers: DecisionResult[];
        if (
          group.length > 1 &&
          provider.capabilities.batch &&
          group.length <= provider.capabilities.maxQuestions
        ) {
          const r = await provider.batch(
            state,
            Object.fromEntries(group.map((c, i) => [`q${i}`, question(c.claim)])),
            callCtx(ctx),
          );
          answers = group.map((_, i) => {
            const a = r.answers[`q${i}`];
            if (!a) throw new NodeExecutionError("the batch did not answer every claim", true);
            return a;
          });
        } else {
          answers = [];
          for (const c of group)
            answers.push(await provider.decideBoolean(state, question(c.claim), callCtx(ctx)));
        }
        group.forEach((c, i) => {
          const a = answers[i];
          if (!a || a.kind !== "boolean") return;
          spent.push(a);
          out.push({ id: c.id, supported: a.value, score: a.pYes });
        });
      }
    } catch (error) {
      if (error instanceof HumanFallbackSignal)
        throw new NodeExecutionError(
          "every decision provider failed while checking citations; use judge: lexical or retry",
          false,
        );
      throw error;
    }
    return out;
  };
}

export const pageindexCiteNode = defineNode({
  id: "flowaid.pageindex.cite",
  version: "1.0.0",
  metadata: {
    name: "PageIndex: Check citations",
    description:
      "Checks that every [E1]-style citation in an answer names retrieved evidence and that the cited text supports the sentence citing it (a TypeSafe yes/no per claim, or a transparent lexical test). Routes sufficient, partial or insufficient.",
    category: "retrieval",
    icon: "quote",
    tags: ["pageindex", "documents", "citations", "grounding", "typesafe"],
    summary: "{{ config.judge }} judge",
  },
  configSchema: z.strictObject({
    judge: z
      .enum(["decision", "lexical"])
      .default("decision")
      .meta({
        "x-ui": {
          help: "decision: a TypeSafe yes/no per cited claim (at most 20). lexical: the claim's numbers and most of its words must appear in the excerpt.",
        },
      }),
    decisionChain: decisionChainSchema,
  }),
  inputSchema: z.object({
    answer: z.string(),
    evidence: z
      .array(evidenceSchema)
      .max(100)
      .meta({ "x-port": { description: "The evidence the answer was written from." } }),
  }),
  outputSchema: z.object({
    answer: z.string(),
    citations: z.array(citationSchema),
    status: z.enum(["sufficient", "partial", "insufficient"]),
    limitations: z.array(z.string()),
    run_id: z.string(),
  }),
  controlPorts: [
    {
      name: "sufficient",
      label: "Sufficient",
      description: "Every citation is real and supported, and every factual sentence cites.",
    },
    {
      name: "partial",
      label: "Partial",
      description:
        "Some citations are unsupported, unknown or unchecked, or some claims cite nothing.",
    },
    {
      name: "insufficient",
      label: "Insufficient",
      description:
        "No supported citation, no evidence, or the answer says the evidence is not enough.",
    },
  ],
  credentials: [
    {
      name: "typesafe",
      types: ["typesafe.api_key"],
      required: false,
      description: "TypeSafe API key for the support checks (judge: decision).",
    },
  ],
  capabilities: ["decision", "credentials"],
  idempotency: "safe",
  defaultPolicy: { timeoutMs: 120_000 },
  execute: async (ctx, input) => {
    const spent: DecisionResult[] = [];
    const evidence = input.evidence as Evidence[];
    const grounded = await checkCitations({
      answer: input.answer,
      evidence,
      runId: ctx.run.id,
      ...(ctx.config.judge === "decision"
        ? { judge: decisionJudge(ctx, ctx.config.decisionChain, spent) }
        : {}),
    });
    const unchecked = grounded.citations.filter((x) => x.supported === null).length;
    if (unchecked > 0) {
      grounded.limitations.push(
        `${unchecked} citation${unchecked === 1 ? " was" : "s were"} not checked (at most ${MAX_SUPPORT_CHECKS} checks per answer)`,
      );
      if (grounded.status === "sufficient") grounded.status = "partial";
    }
    const usage = spent.reduce(
      (a, d) => ({
        inputTokens: a.inputTokens + (d.usage?.inputTokens ?? 0),
        outputTokens: a.outputTokens + (d.usage?.outputTokens ?? 0),
      }),
      { inputTokens: 0, outputTokens: 0 },
    );
    // not a decision node: the checks' spend is reported, the route is the grounding status
    const output = {
      answer: grounded.answer,
      citations: grounded.citations,
      status: grounded.status,
      limitations: grounded.limitations,
      run_id: grounded.runId,
    };
    return ok(output, {
      route: grounded.status,
      costUsd: spent.reduce((a, d) => a + d.costUsd, 0),
      ...(spent.length ? { usage } : {}),
    });
  },
});
