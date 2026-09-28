/**
 * Evidence retrieval by navigating a document's section tree (the PageIndex method): at each
 * level a decision provider chooses among the sections, with a probability for each, and the
 * chosen sections are either opened (their children become the next choice) or read (their
 * pages become evidence). No embeddings; the path to every excerpt is a chain of choices over
 * titles and summaries, and every excerpt is the source text of real pages.
 *
 * One owner for the budget: this loop. It counts decisions, sections and pages against the
 * limits, stops cleanly when one runs out and says so (`status: "partial"` with a warning).
 */
import type {
  Evidence,
  IndexReference,
  OutlineNode,
  RetrievalResult,
  TokenUsage,
} from "@flowaid/workflow-core";

/** One choice among options, answered with a probability per option. */
export interface NavigatorChoice {
  instructions: string;
  /** option key → description (keys ^[a-z0-9_]{1,64}$) */
  options: Record<string, string>;
  state: string;
}
export interface NavigatorAnswer {
  value: string;
  probabilities: Record<string, number>;
  confidence: number | null;
  provider: string | null;
  usage?: TokenUsage | undefined;
  costUsd: number;
}
export type Navigator = (choice: NavigatorChoice) => Promise<NavigatorAnswer>;

export interface RetrievalBudget {
  /** evidence items returned (default 6) */
  maxSections: number;
  /** pages read in total (default 12) */
  maxPages: number;
  /** navigator calls in total (default 24) */
  maxDecisions: number;
  /** a chosen section spanning more pages than this is opened rather than read (default 3) */
  maxPagesPerSection: number;
  /** sections chosen per level (default 2) */
  branching: number;
  /** a section is chosen when its probability reaches this (default 0.15) */
  minProbability: number;
  /** characters of source text per evidence item (default 4,000) */
  excerptChars: number;
  /** documents navigated (default 5); more fails the request rather than silently skipping */
  maxDocuments: number;
}

export const DEFAULT_BUDGET: RetrievalBudget = {
  maxSections: 6,
  maxPages: 12,
  maxDecisions: 24,
  maxPagesPerSection: 3,
  branching: 2,
  minProbability: 0.15,
  excerptChars: 4000,
  maxDocuments: 5,
};

export interface RetrieveInput {
  query: string;
  indexes: readonly IndexReference[];
  outline: (indexId: string) => Promise<OutlineNode[]>;
  readPages: (indexId: string, pages: number[]) => Promise<{ page: number; text: string }[]>;
  navigate: Navigator;
  budget?: Partial<RetrievalBudget>;
  now?: () => number;
}

const NONE = "none";
const MAX_OPTIONS = 60;
const SUMMARY_CHARS = 400;

interface Candidate {
  index: IndexReference;
  node: OutlineNode;
  path: string[];
  confidence: number | null;
  provider: string | null;
}

class BudgetExhausted extends Error {}

/** Retrieves evidence for `query` from the given (ready, authorized) indexes. */
export async function retrieveEvidence(input: RetrieveInput): Promise<RetrievalResult> {
  const b: RetrievalBudget = { ...DEFAULT_BUDGET, ...input.budget };
  const now = input.now ?? (() => Date.now());
  const started = now();
  if (input.indexes.length > b.maxDocuments)
    throw new RangeError(
      `retrieval covers at most ${b.maxDocuments} documents at once; ${input.indexes.length} were given`,
    );
  const warnings: string[] = [];
  let decisions = 0;
  let sectionsInspected = 0;
  let pagesRead = 0;
  let costUsd = 0;
  let usage: TokenUsage | null = null;
  let exhausted = false;

  const decide = async (choice: NavigatorChoice): Promise<NavigatorAnswer> => {
    if (decisions >= b.maxDecisions) throw new BudgetExhausted("decisions");
    decisions++;
    const a = await input.navigate(choice);
    costUsd += a.costUsd;
    if (a.usage)
      usage = {
        inputTokens: (usage?.inputTokens ?? 0) + a.usage.inputTokens,
        outputTokens: (usage?.outputTokens ?? 0) + a.usage.outputTokens,
      };
    return a;
  };

  /** Chooses sections among `nodes`; a lone section is taken without asking. */
  const choose = async (
    index: IndexReference,
    nodes: OutlineNode[],
    path: string[],
  ): Promise<{ node: OutlineNode; confidence: number | null; provider: string | null }[]> => {
    sectionsInspected += nodes.length;
    if (nodes.length === 1 && nodes[0])
      return [{ node: nodes[0], confidence: null, provider: null }];
    const shown = nodes.slice(0, MAX_OPTIONS);
    if (nodes.length > MAX_OPTIONS)
      warnings.push(
        `${index.displayName}: ${nodes.length - MAX_OPTIONS} sections at one level were not offered (at most ${MAX_OPTIONS})`,
      );
    const options: Record<string, string> = {};
    shown.forEach((n, i) => {
      const snippet = sectionSnippet(n, shown[i + 1]);
      options[`s${i}`] = `${n.title} (pages ${pageSpan(n)})${snippet ? ` — ${snippet}` : ""}`;
    });
    options[NONE] = "None of these sections is likely to contain the answer";
    const where = path.length ? ` within "${path.join(" › ")}"` : "";
    const a = await decide({
      instructions: `Which section of the document "${index.displayName}"${where} is most likely to contain the information needed to answer the question?`,
      options,
      state: `Question: ${input.query}`,
    });
    return shown
      .map((node, i) => ({ node, p: a.probabilities[`s${i}`] ?? (a.value === `s${i}` ? 1 : 0) }))
      .filter((x) => x.p >= b.minProbability)
      .sort((x, y) => y.p - x.p)
      .slice(0, b.branching)
      .map((x) => ({ node: x.node, confidence: x.p, provider: a.provider }));
  };

  const candidates: Candidate[] = [];
  const failedDocs: string[] = [];
  try {
    for (const index of input.indexes) {
      let outline: OutlineNode[];
      try {
        outline = await input.outline(index.indexId);
      } catch (error) {
        failedDocs.push(index.displayName);
        warnings.push(
          `${index.displayName}: the outline could not be read (${error instanceof Error ? error.message : "unknown error"})`,
        );
        continue;
      }
      // breadth-first over chosen sections
      let frontier: { nodes: OutlineNode[]; path: string[]; confidence: number | null }[] = [
        { nodes: outline, path: [], confidence: null },
      ];
      while (frontier.length && candidates.length < b.maxSections) {
        const next: typeof frontier = [];
        for (const level of frontier) {
          if (!level.nodes.length) continue;
          for (const c of await choose(index, level.nodes, level.path)) {
            const confidence =
              level.confidence === null || c.confidence === null
                ? (c.confidence ?? level.confidence)
                : level.confidence * c.confidence;
            const span = c.node.endPage - c.node.startPage + 1;
            if (c.node.children?.length && span > b.maxPagesPerSection) {
              next.push({
                nodes: c.node.children,
                path: [...level.path, c.node.title],
                confidence,
              });
            } else {
              candidates.push({
                index,
                node: c.node,
                path: [...level.path, c.node.title],
                confidence,
                provider: c.provider,
              });
            }
          }
        }
        frontier = next;
      }
    }
  } catch (error) {
    if (!(error instanceof BudgetExhausted)) throw error;
    exhausted = true;
    warnings.push(`stopped at the decision budget (${b.maxDecisions} choices)`);
  }

  // read the most confident sections first, within the page budget
  candidates.sort((x, y) => (y.confidence ?? 0.5) - (x.confidence ?? 0.5));
  const evidence: Evidence[] = [];
  const read = new Set<string>();
  for (const c of candidates) {
    if (evidence.length >= b.maxSections) break;
    // sibling sections often share a page: read it once, under the most confident section
    const span = `${c.index.indexId}:${c.node.startPage}-${Math.min(c.node.endPage, c.node.startPage + b.maxPagesPerSection - 1)}`;
    if (read.has(span)) continue;
    read.add(span);
    const remaining = b.maxPages - pagesRead;
    if (remaining <= 0) {
      exhausted = true;
      warnings.push(`stopped at the page budget (${b.maxPages} pages)`);
      break;
    }
    const first = c.node.startPage;
    const last = Math.min(c.node.endPage, first + Math.min(b.maxPagesPerSection, remaining) - 1);
    const wanted = Array.from({ length: last - first + 1 }, (_, i) => first + i);
    let pages: { page: number; text: string }[];
    try {
      pages = await input.readPages(c.index.indexId, wanted);
    } catch (error) {
      warnings.push(
        `${c.index.displayName}: pages ${first}–${last} could not be read (${error instanceof Error ? error.message : "unknown error"})`,
      );
      continue;
    }
    pagesRead += pages.length;
    const text = pages
      .sort((x, y) => x.page - y.page)
      .map((p) => p.text.trim())
      .filter(Boolean)
      .join("\n\n");
    if (!text) continue;
    const truncated = text.length > b.excerptChars || last < c.node.endPage;
    evidence.push({
      id: `E${evidence.length + 1}`,
      indexId: c.index.indexId,
      documentId: c.index.documentId,
      versionId: c.index.versionId,
      documentVersion: c.index.documentVersion,
      indexVersion: c.index.indexVersion,
      displayName: c.index.displayName,
      nodeId: c.node.nodeId,
      sectionPath: c.path,
      excerpt: text.slice(0, b.excerptChars),
      truncated,
      locator: { kind: "pdf_page", page: first, endPage: last, pageLabel: null },
      provenance: {
        method: "tree_navigation",
        confidence: c.confidence === null ? null : Number(c.confidence.toFixed(4)),
        provider: c.provider,
      },
    });
  }

  if (failedDocs.length) exhausted = true;
  return {
    evidence,
    status:
      evidence.length === 0
        ? exhausted
          ? "partial"
          : "empty"
        : exhausted
          ? "partial"
          : "complete",
    warnings,
    activity: {
      documents: input.indexes.length,
      sectionsInspected,
      pagesRead,
      decisions,
      elapsedMs: Math.max(0, Math.round(now() - started)),
    },
    usage,
    costUsd: Number(costUsd.toFixed(6)),
  };
}

/**
 * What a section is about, for the navigator. A short section's summary is the raw text of its
 * page(s), shared by every section on them, so it is cut to this section: from its own title to
 * the next section's title when both appear in it.
 */
export function sectionSnippet(node: OutlineNode, next: OutlineNode | undefined): string {
  if (!node.summary) return "";
  let text = node.summary.replace(/\s+/g, " ").trim();
  const title = node.title.replace(/\s+/g, " ").trim();
  const start = title ? text.indexOf(title) : -1;
  if (start >= 0) text = text.slice(start + title.length).trim();
  const nextTitle = next?.title.replace(/\s+/g, " ").trim();
  if (nextTitle) {
    const end = text.indexOf(nextTitle);
    if (end > 0) text = text.slice(0, end).trim();
  }
  return text.slice(0, SUMMARY_CHARS);
}

function pageSpan(n: OutlineNode): string {
  return n.startPage === n.endPage ? `${n.startPage}` : `${n.startPage}–${n.endPage}`;
}

/** Evidence as a numbered block for a prompt; each item names its marker, document and pages. */
export function evidenceForPrompt(evidence: readonly Evidence[]): string {
  return evidence
    .map((e) => {
      const pages =
        e.locator.page === e.locator.endPage
          ? `page ${e.locator.page}`
          : `pages ${e.locator.page}–${e.locator.endPage}`;
      const section = e.sectionPath.length ? `, section "${e.sectionPath.join(" › ")}"` : "";
      return `[${e.id}] ${e.displayName}${section}, ${pages}:\n${e.excerpt}`;
    })
    .join("\n\n");
}
