/**
 * The PageIndex evaluation set (docs/pageindex/EVALUATION.md): questions over the sample PDFs in
 * fixtures/pageindex with the physical pages that answer them, what a correct answer must say,
 * and which questions have no answer in the documents. The live runner (`pnpm eval:pageindex`)
 * indexes the samples through the service, retrieves with the workspace's navigator, answers
 * with a generation model and scores the result with `scorePageIndexCase`.
 *
 * Thresholds are fixed here, before any run, and reported against: see `THRESHOLDS`.
 */
import type { Evidence, GroundedAnswer, RetrievalResult } from "@flowaid/workflow-core";

export type SampleDocument = "handbook" | "travel";

export const SAMPLE_FILES: Record<SampleDocument, string> = {
  handbook: "northwind-support-handbook.pdf",
  travel: "northwind-travel-policy.pdf",
};

export interface PageIndexEvalCase {
  id: string;
  kind:
    | "single_section"
    | "cross_section"
    | "ambiguous"
    | "contradiction"
    | "multi_document"
    | "unanswerable";
  question: string;
  documents: SampleDocument[];
  /** physical pages that support the answer, per document (every listed page must be retrieved) */
  expectedPages: Partial<Record<SampleDocument, number[]>>;
  /** each must appear in a correct answer */
  mustMention: RegExp[];
  /** the documents cannot answer it: a correct run says so */
  unanswerable?: boolean;
}

export const PAGEINDEX_EVAL_CASES: readonly PageIndexEvalCase[] = [
  {
    id: "refund-approver",
    kind: "single_section",
    question: "Who approves a refund of $600?",
    documents: ["handbook"],
    expectedPages: { handbook: [1] },
    mustMention: [/team lead/i],
  },
  {
    id: "deletion-deadline",
    kind: "single_section",
    question: "How long does the privacy team take to complete a deletion request?",
    documents: ["handbook"],
    expectedPages: { handbook: [2] },
    mustMention: [/30 days/i],
  },
  {
    id: "hotel-limit-london",
    kind: "single_section",
    question: "What is the nightly hotel limit in London?",
    documents: ["travel"],
    expectedPages: { travel: [1] },
    mustMention: [/\$?260/],
  },
  {
    id: "late-claim",
    kind: "single_section",
    question: "Is an expense claim submitted 70 days after returning reimbursed?",
    documents: ["travel"],
    expectedPages: { travel: [3] },
    mustMention: [/not|no\b/i, /60 days/i],
  },
  {
    id: "international-trip-approvals",
    kind: "cross_section",
    question: "Which approvals does a $6,000 international trip need?",
    documents: ["travel"],
    expectedPages: { travel: [2] },
    mustMention: [/manager/i, /finance/i, /director/i],
  },
  {
    id: "premium-first-response",
    kind: "cross_section",
    question:
      "How quickly do premium customers get a first response, and do they have a named contact?",
    documents: ["handbook"],
    expectedPages: { handbook: [2] },
    mustMention: [/2 business hours/i, /named/i],
  },
  {
    id: "business-class-contradiction",
    kind: "contradiction",
    question: "For how long must a flight be before business class is allowed?",
    documents: ["travel"],
    expectedPages: { travel: [1, 4] },
    mustMention: [/8 hours/i, /6 hours/i],
  },
  {
    id: "refund-limit-history",
    kind: "ambiguous",
    question: "What is the team-lead refund limit?",
    documents: ["handbook"],
    expectedPages: { handbook: [1] },
    mustMention: [/\$?1,?000/],
  },
  {
    id: "retention-across-documents",
    kind: "multi_document",
    question:
      "How long are chat transcripts kept, and how long do travellers have to submit expense claims?",
    documents: ["handbook", "travel"],
    expectedPages: { handbook: [3], travel: [3] },
    mustMention: [/90 days/i, /30 days/i],
  },
  {
    id: "parental-leave",
    kind: "unanswerable",
    question: "How many weeks of parental leave do employees get?",
    documents: ["handbook", "travel"],
    expectedPages: {},
    mustMention: [],
    unanswerable: true,
  },
  {
    id: "ceo-name",
    kind: "unanswerable",
    question: "Who is Northwind's chief executive?",
    documents: ["handbook"],
    expectedPages: {},
    mustMention: [],
    unanswerable: true,
  },
];

/** Acceptance thresholds, set before the first run. */
export const THRESHOLDS = {
  /** answerable cases whose expected pages were all retrieved */
  evidenceRecall: 0.8,
  /** citations that point at retrieved evidence (structural: must be 1) */
  citationValidity: 1,
  /** citations judged to support their sentence */
  citationSupport: 0.8,
  /** answerable cases whose answer says what it must (a small local model answers) */
  answerCorrectness: 0.7,
  /** unanswerable cases reported insufficient */
  abstention: 1,
} as const;

export interface PageIndexCaseResult {
  id: string;
  kind: PageIndexEvalCase["kind"];
  /** every expected page was among the evidence (null for unanswerable cases) */
  evidenceHit: boolean | null;
  pagesRetrieved: Record<string, number[]>;
  citations: number;
  validCitations: number;
  supportedCitations: number;
  answerCorrect: boolean | null;
  abstained: boolean;
  status: GroundedAnswer["status"] | "error";
  latencyMs: number;
  decisions: number;
  costUsd: number;
  error?: string;
}

/** Scores one case from its retrieval and checked answer. `pagesOf` maps evidence to a sample. */
export function scorePageIndexCase(
  c: PageIndexEvalCase,
  retrieval: RetrievalResult,
  answer: GroundedAnswer,
  sampleOf: (e: Evidence) => SampleDocument | null,
  latencyMs: number,
): PageIndexCaseResult {
  const pages: Record<string, Set<number>> = {};
  for (const e of retrieval.evidence) {
    const doc = sampleOf(e);
    if (!doc) continue;
    pages[doc] ??= new Set();
    for (let p = e.locator.page; p <= e.locator.endPage; p++) pages[doc].add(p);
  }
  const expected = Object.entries(c.expectedPages) as [SampleDocument, number[]][];
  const evidenceHit = c.unanswerable
    ? null
    : expected.every(([doc, want]) => want.every((p) => pages[doc]?.has(p) ?? false));
  const evidenceIds = new Set(retrieval.evidence.map((e) => e.id));
  const valid = answer.citations.filter((x) => evidenceIds.has(x.evidenceId));
  const abstained = answer.status === "insufficient";
  return {
    id: c.id,
    kind: c.kind,
    evidenceHit,
    pagesRetrieved: Object.fromEntries(
      Object.entries(pages).map(([k, v]) => [k, [...v].sort((a, b) => a - b)]),
    ),
    citations: answer.citations.length,
    validCitations: valid.length,
    supportedCitations: valid.filter((x) => x.supported === true).length,
    answerCorrect: c.unanswerable
      ? null
      : !abstained && c.mustMention.every((re) => re.test(answer.answer)),
    abstained,
    status: answer.status,
    latencyMs,
    decisions: retrieval.activity.decisions,
    costUsd: retrieval.costUsd,
  };
}

export interface PageIndexEvalSummary {
  cases: number;
  evidenceRecall: { value: number; of: number };
  citationValidity: { value: number; of: number };
  citationSupport: { value: number; of: number };
  answerCorrectness: { value: number; of: number };
  abstention: { value: number; of: number };
  meanLatencyMs: number;
  decisions: number;
  costUsd: number;
  passed: Record<keyof typeof THRESHOLDS, boolean>;
}

const ratio = (hits: number, of: number) => ({ value: of ? hits / of : 1, of });

export function summarizePageIndexEval(
  results: readonly PageIndexCaseResult[],
): PageIndexEvalSummary {
  const answerable = results.filter((r) => r.evidenceHit !== null);
  const unanswerable = results.filter((r) => r.evidenceHit === null);
  const citations = results.reduce((a, r) => a + r.citations, 0);
  const valid = results.reduce((a, r) => a + r.validCitations, 0);
  const s = {
    cases: results.length,
    evidenceRecall: ratio(answerable.filter((r) => r.evidenceHit).length, answerable.length),
    citationValidity: ratio(valid, citations),
    citationSupport: ratio(
      results.reduce((a, r) => a + r.supportedCitations, 0),
      valid,
    ),
    answerCorrectness: ratio(answerable.filter((r) => r.answerCorrect).length, answerable.length),
    abstention: ratio(unanswerable.filter((r) => r.abstained).length, unanswerable.length),
    meanLatencyMs: results.length
      ? Math.round(results.reduce((a, r) => a + r.latencyMs, 0) / results.length)
      : 0,
    decisions: results.reduce((a, r) => a + r.decisions, 0),
    costUsd: Number(results.reduce((a, r) => a + r.costUsd, 0).toFixed(6)),
  };
  return {
    ...s,
    passed: {
      evidenceRecall: s.evidenceRecall.value >= THRESHOLDS.evidenceRecall,
      citationValidity: s.citationValidity.value >= THRESHOLDS.citationValidity,
      citationSupport: s.citationSupport.value >= THRESHOLDS.citationSupport,
      answerCorrectness: s.answerCorrectness.value >= THRESHOLDS.answerCorrectness,
      abstention: s.abstention.value >= THRESHOLDS.abstention,
    },
  };
}
