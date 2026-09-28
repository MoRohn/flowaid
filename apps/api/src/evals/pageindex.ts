/**
 * `pnpm eval:pageindex`: the PageIndex evaluation set, end to end on the real path (see
 * docs/pageindex/EVALUATION.md). It indexes the sample PDFs through the running PageIndex
 * service, retrieves with TypeSafe Jev choosing sections, answers with a generation model and
 * judges each citation with Jev, then scores against the thresholds fixed in
 * `@flowaid/pageindex` evals. Nothing touches FlowAId's database.
 *
 *   FLOWAID_PAGEINDEX_URL=… FLOWAID_PAGEINDEX_TOKEN=… TYPESAFE_API_KEY=… \
 *     pnpm eval:pageindex -- --index-model ollama/qwen2.5:3b --answer-model qwen2.5:3b
 *
 * Exits 1 when a threshold is missed.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  ANSWER_INSTRUCTIONS,
  LOCAL_CAPABILITIES,
  PAGEINDEX_EVAL_CASES,
  PageIndexServiceClient,
  SAMPLE_FILES,
  THRESHOLDS,
  checkCitations,
  evidenceForPrompt,
  retrieveEvidence,
  scorePageIndexCase,
  summarizePageIndexEval,
  type Navigator,
  type PageIndexCaseResult,
  type SampleDocument,
  type ServiceOutlineNode,
  type SupportJudge,
} from "@flowaid/pageindex";
import { ollamaFactory } from "@flowaid/provider-ollama";
import { typesafeFactory } from "@flowaid/provider-typesafe";
import { DefaultModelCatalog, createSafeFetch } from "@flowaid/providers";
import { uuidv7, wrapUntrusted } from "@flowaid/shared";
import type { IndexReference, OutlineNode } from "@flowaid/workflow-core";

const SAMPLES = resolve(import.meta.dirname, "../../../../fixtures/pageindex");

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const { values } = parseArgs({
    // `pnpm eval:… -- --flag` passes the separator through
    args: argv[0] === "--" ? argv.slice(1) : argv,
    options: {
      "index-model": { type: "string", default: "ollama/qwen2.5:3b" },
      "answer-model": { type: "string", default: "qwen2.5:3b" },
      json: { type: "string" },
    },
  });
  const url = process.env.FLOWAID_PAGEINDEX_URL;
  const token = process.env.FLOWAID_PAGEINDEX_TOKEN;
  const typesafeKey = process.env.TYPESAFE_API_KEY;
  const ollama = process.env.OLLAMA_HOST ?? "http://127.0.0.1:11434";
  if (!url || !token || !typesafeKey) {
    console.error("set FLOWAID_PAGEINDEX_URL, FLOWAID_PAGEINDEX_TOKEN and TYPESAFE_API_KEY");
    return 2;
  }
  const catalog = new DefaultModelCatalog();
  const http = createSafeFetch({
    timeoutMs: 300_000,
    userAgent: "FlowAId-Eval/1",
    allowPrivate: true,
  });
  const service = new PageIndexServiceClient({ baseUrl: url, token, timeoutMs: 120_000 });
  const jev = typesafeFactory().create({
    model: "",
    credential: { apiKey: typesafeKey },
    http,
    catalog,
  });
  const writer = ollamaFactory().create({
    model: values["answer-model"],
    credential: { host: ollama },
    http,
    catalog,
  });
  const call = () => ({
    signal: AbortSignal.timeout(300_000),
    runId: "eval",
    nodeRunId: uuidv7(),
    idempotencyKey: null,
  });

  // ── index the samples ──
  const workspaceId = randomUUID();
  const indexes = new Map<
    SampleDocument,
    { ref: IndexReference; docId: string; outline: OutlineNode[] }
  >();
  for (const [doc, file] of Object.entries(SAMPLE_FILES) as [SampleDocument, string][]) {
    const pdf = new Uint8Array(readFileSync(resolve(SAMPLES, file)));
    const jobId = randomUUID();
    const started = Date.now();
    await service.submitJob({
      jobId,
      workspaceId,
      fileName: file,
      contentSha256: createHash("sha256").update(pdf).digest("hex"),
      mode: "flash",
      optimize: "off",
      model: {
        litellm: values["index-model"],
        ...(values["index-model"].startsWith("ollama/") ? { apiBase: ollama } : {}),
      },
      indexId: `eval-${doc}`,
      pdf,
    });
    let status = await service.getJob(workspaceId, jobId);
    while (status.state === "queued" || status.state === "running") {
      await new Promise((r) => setTimeout(r, 1500));
      status = await service.getJob(workspaceId, jobId);
    }
    if (status.state !== "ready" || !status.result)
      throw new Error(`${file} did not index: ${status.error?.message ?? status.state}`);
    const r = status.result;
    console.log(
      `indexed ${file}: ${r.pageCount} pages in ${Date.now() - started} ms (sdk ${r.sdkVersion})`,
    );
    indexes.set(doc, {
      docId: r.docId,
      outline: toOutline(r.tree),
      ref: {
        indexId: `eval-${doc}`,
        documentId: doc,
        sourceId: "eval",
        versionId: "v1",
        documentVersion: 1,
        indexVersion: 1,
        displayName: file,
        state: "ready",
        active: true,
        backend: "pageindex",
        mode: "local",
        backendVersion: `pageindex ${r.sdkVersion}`,
        configHash: "eval",
        indexModel: values["index-model"],
        pageCount: r.pageCount,
        stage: null,
        error: null,
        createdAt: new Date().toISOString(),
        readyAt: new Date().toISOString(),
        capabilities: LOCAL_CAPABILITIES,
      },
    });
  }
  const byIndex = new Map([...indexes.values()].map((x) => [x.ref.indexId, x]));

  const navigate: Navigator = async (choice) => {
    const d = await jev.decideChoice(
      choice.state,
      { kind: "choice", instructions: choice.instructions, options: choice.options },
      call(),
    );
    return {
      value: d.value,
      probabilities: d.probabilities,
      confidence: d.confidence,
      provider: d.provider,
      usage: d.usage,
      costUsd: d.costUsd,
    };
  };
  const judge: SupportJudge = async (checks) =>
    Promise.all(
      checks.map(async (c) => {
        const d = await jev.decideBoolean(
          c.evidence.excerpt,
          {
            kind: "boolean",
            instructions: `Does the text fully support this statement? Statement: ${c.claim}`,
          },
          call(),
        );
        return { id: c.id, supported: d.value, score: d.pYes };
      }),
    );

  // ── the cases ──
  const results: PageIndexCaseResult[] = [];
  for (const c of PAGEINDEX_EVAL_CASES) {
    const started = Date.now();
    try {
      const refs = c.documents.flatMap((d) => {
        const x = indexes.get(d);
        return x ? [x.ref] : [];
      });
      const retrieval = await retrieveEvidence({
        query: c.question,
        indexes: refs,
        outline: (id) => Promise.resolve(byIndex.get(id)?.outline ?? []),
        readPages: (id, pages) => service.pages(workspaceId, byIndex.get(id)?.docId ?? "", pages),
        navigate,
      });
      const prompt = `${ANSWER_INSTRUCTIONS}\n\nQuestion: ${c.question}\n\n${wrapUntrusted(evidenceForPrompt(retrieval.evidence), { label: "retrieved document evidence", maxTokens: 12_000 })}`;
      const written = retrieval.evidence.length
        ? (
            await writer.generate(
              {
                messages: [{ role: "user", content: prompt }],
                temperature: 0,
                maxOutputTokens: 600,
              },
              call(),
            )
          ).text
        : "INSUFFICIENT_EVIDENCE No evidence was found.";
      const grounded = await checkCitations({
        answer: written,
        evidence: retrieval.evidence,
        runId: "eval",
        judge,
      });
      const scored = scorePageIndexCase(
        c,
        retrieval,
        grounded,
        (e) => e.documentId as SampleDocument,
        Date.now() - started,
      );
      results.push(scored);
      console.log(
        `${c.id}: ${grounded.status}, pages ${JSON.stringify(scored.pagesRetrieved)}, evidence ${scored.evidenceHit ?? "n/a"}, correct ${scored.answerCorrect ?? "n/a"}`,
      );
    } catch (error) {
      results.push({
        id: c.id,
        kind: c.kind,
        evidenceHit: c.unanswerable ? null : false,
        pagesRetrieved: {},
        citations: 0,
        validCitations: 0,
        supportedCitations: 0,
        answerCorrect: c.unanswerable ? null : false,
        abstained: false,
        status: "error",
        latencyMs: Date.now() - started,
        decisions: 0,
        costUsd: 0,
        error: error instanceof Error ? error.message : String(error),
      });
      console.log(`${c.id}: error ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  for (const { docId } of indexes.values()) await service.deleteDocument(workspaceId, docId);
  const summary = summarizePageIndexEval(results);
  const pct = (x: { value: number; of: number }) => `${(x.value * 100).toFixed(0)}% (n=${x.of})`;
  console.log(`
## PageIndex evaluation: index ${values["index-model"]}, answers ${values["answer-model"]}, navigator typesafe

| measure | result | threshold | passed |
| ------- | ------ | --------- | ------ |
| evidence recall | ${pct(summary.evidenceRecall)} | ${THRESHOLDS.evidenceRecall} | ${summary.passed.evidenceRecall} |
| citation validity | ${pct(summary.citationValidity)} | ${THRESHOLDS.citationValidity} | ${summary.passed.citationValidity} |
| citation support | ${pct(summary.citationSupport)} | ${THRESHOLDS.citationSupport} | ${summary.passed.citationSupport} |
| answer correctness | ${pct(summary.answerCorrectness)} | ${THRESHOLDS.answerCorrectness} | ${summary.passed.answerCorrectness} |
| abstention | ${pct(summary.abstention)} | ${THRESHOLDS.abstention} | ${summary.passed.abstention} |

Mean latency ${summary.meanLatencyMs} ms per question · ${summary.decisions} navigator decisions · navigator cost $${summary.costUsd.toFixed(6)}`);
  if (values.json) writeFileSync(values.json, JSON.stringify({ summary, results }, null, 2));
  return Object.values(summary.passed).every(Boolean) ? 0 : 1;
}

function toOutline(nodes: ServiceOutlineNode[]): OutlineNode[] {
  return nodes.map((n) => ({
    nodeId: n.nodeId,
    title: n.title,
    startPage: n.startPage,
    endPage: n.endPage,
    ...(n.summary ? { summary: n.summary } : {}),
    ...(n.children?.length ? { children: toOutline(n.children) } : {}),
  }));
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(2);
  },
);
