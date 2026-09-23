/**
 * Text heuristics behind the ◊ lints of JEV_ENGINEERING.md §13.2. They are warnings only and
 * deliberately conservative: a contract written the way the handbook recommends (evidence
 * conditions, verbal anchors, operational instructions) must not trip them.
 */

const STOPWORDS = new Set([
  "a",
  "an",
  "the",
  "is",
  "are",
  "was",
  "be",
  "to",
  "of",
  "and",
  "or",
  "in",
  "on",
  "for",
  "with",
  "this",
  "that",
  "it",
  "its",
  "as",
  "at",
  "by",
  "from",
  "any",
  "all",
  "no",
  "not",
  "do",
  "does",
  "should",
  "can",
  "will",
  "there",
]);

/** Lower-case word tokens (letters/digits). */
export function words(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9]+(?:'[a-z]+)?/g) ?? [];
}

/** Content words: tokens minus stopwords. */
export function contentWords(text: string): string[] {
  return words(text).filter((w) => !STOPWORDS.has(w));
}

/** Token-set Jaccard similarity of two texts (content words). */
export function jaccard(a: string, b: string): number {
  const sa = new Set(contentWords(a));
  const sb = new Set(contentWords(b));
  if (sa.size === 0 && sb.size === 0) return 1;
  let inter = 0;
  for (const w of sa) if (sb.has(w)) inter += 1;
  return inter / (sa.size + sb.size - inter);
}

const PRAISE = new Set([
  "fast",
  "faster",
  "fastest",
  "quick",
  "capable",
  "best",
  "great",
  "good",
  "excellent",
  "powerful",
  "reliable",
  "smart",
  "efficient",
  "amazing",
  "versatile",
  "strong",
  "robust",
  "accurate",
  "premium",
  "advanced",
  "high",
  "quality",
  "top",
  "expert",
  "reliable",
  "trusted",
  "helpful",
  "cheap",
  "cheapest",
  "affordable",
  "flexible",
]);

/** Every content word is praise ("fast and capable"): the description does not distinguish (§VIII.F). */
export function isPraiseOnly(text: string): boolean {
  const cw = contentWords(text);
  return cw.length > 0 && cw.every((w) => PRAISE.has(w));
}

/** The description narrates several steps ("search, then verify, then send") — a plan in one label (§X.J). */
export function describesMultiStepPlan(text: string): boolean {
  return (
    /\b(and then|then|after that|afterwards|followed by|finally)\b/i.test(text) &&
    /,|;|\band\b/i.test(text)
  );
}

const VAGUE =
  /\b(safe|good|ok|okay|appropriate|valid|fine|acceptable|proper|correct|reasonable)\b/i;

/**
 * Weak instructions (§III.A): under 8 words and either built on a vague predicate ("Is this
 * safe?") or merely restating the contract's identifier.
 */
export function isWeakInstruction(instructions: string, key: string): boolean {
  const all = words(instructions);
  if (all.length >= 8) return false;
  if (VAGUE.test(instructions)) return true;
  const idWords = new Set(
    key
      .toLowerCase()
      .split(/[._]+/)
      .filter((w) => w !== ""),
  );
  const cw = contentWords(instructions);
  return cw.length > 0 && cw.every((w) => idWords.has(w) || idWords.has(w.replace(/s$/, "")));
}

/** Multi-label phrasing on a Choice (§II.G): several options may be true at once. */
export function isMultiLabelPhrasing(instructions: string): boolean {
  return /\b(select all|all that apply|one or more|any that apply|every option that|multiple (?:options|labels|categories))\b/i.test(
    instructions,
  );
}

/** Severity/degree phrasing on a Noul (§II.C: Noul is uncertainty, not severity). */
export function isSeverityPhrasing(instructions: string): boolean {
  return /\b(how (?:much|severe|serious|risky|urgent|bad|good|well|strongly)|to what (?:degree|extent)|what level of|severity|rate the)\b/i.test(
    instructions,
  );
}

const ORDINAL_MARKERS = new Set([
  "no",
  "none",
  "not",
  "never",
  "low",
  "lower",
  "lowest",
  "minor",
  "minimal",
  "slight",
  "slightly",
  "little",
  "few",
  "some",
  "partial",
  "partially",
  "moderate",
  "moderately",
  "medium",
  "mixed",
  "high",
  "higher",
  "highest",
  "major",
  "severe",
  "critical",
  "strong",
  "strongly",
  "full",
  "fully",
  "complete",
  "completely",
  "weak",
  "very",
  "most",
  "least",
  "many",
  "much",
  "mostly",
  "clear",
  "clearly",
  "unclear",
  "direct",
  "indirect",
  "multiple",
  "single",
  "trivial",
  "significant",
  "extreme",
  "urgent",
  "immediate",
  "limited",
  "adequate",
  "insufficient",
  "sufficient",
  "poor",
  "fair",
  "excellent",
  "negligible",
  "substantial",
  "basic",
  "irrelevant",
  "relevant",
  "tangential",
]);

/** Share of levels carrying ordinal vocabulary; categories dressed as a scale score low (§II.G). */
export function ordinalLevelShare(levels: readonly string[]): number {
  if (levels.length === 0) return 1;
  const withMarker = levels.filter((l) => words(l).some((w) => ORDINAL_MARKERS.has(w)));
  return withMarker.length / levels.length;
}

/** A level anchor that is only a number ("3", "80%"). */
export function isNumericOnly(level: string): boolean {
  return /^\s*[-+]?\d+(?:\.\d+)?\s*%?\s*$/.test(level);
}

/**
 * Exact-rule phrasing (§X.H): comparisons of counts, dates, amounts, allowlists or exact strings
 * that code can decide exactly.
 */
export function exactRuleMatch(instructions: string): string | null {
  const patterns: [RegExp, string][] = [
    [/\b(?:more|fewer|less|greater|larger|smaller|older|newer) than \$?\d/i, "numeric comparison"],
    [/\b(?:at least|at most|exactly|no more than|no fewer than|up to) \$?\d/i, "numeric bound"],
    [/(?:>=|<=|==|!=|>|<)\s*\$?\d/, "comparison operator"],
    [
      /\b(?:before|after|on or before|on or after|since|until) (?:\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{2,4})/i,
      "date comparison",
    ],
    [/\b(?:allow-?list|white-?list|block-?list|deny-?list|black-?list)\b/i, "allowlist membership"],
    [
      /\b(?:equals?|exactly matches|is exactly|is equal to|matches the string) ["'`]/i,
      "exact string",
    ],
    [/\b(?:attempts?|retries|tries) (?:is|are|exceeds?|reached?) \d/i, "attempt count"],
  ];
  for (const [re, what] of patterns) if (re.test(instructions)) return what;
  return null;
}

/** Free-value phrasing (§X.I): the question asks for a value that is not on the menu. */
export function freeValueMatch(instructions: string): string | null {
  const re =
    /\b(?:what|which) (?:is|are|was) the (name|url|link|id|identifier|number|email|e-mail|date|amount|address|price|phone|value)\b|\b(?:extract|return|provide|give|write|generate|output|produce|list) (?:the |a |an )?(name|url|link|id|identifier|number|email|e-mail|date|amount|address|price|phone)s?\b|\bhow many\b/i;
  const m = re.exec(instructions);
  if (!m) return null;
  return m[1] ?? m[2] ?? "count";
}

/** Tokens of a field name that express a conclusion rather than an observation (§X.A, §13.2 list). */
const CONCLUSION_TOKENS = new Set([
  "probably",
  "likely",
  "seems",
  "enough",
  "sufficient",
  "done",
  "ok",
  "okay",
]);

/** The field name reads like an inherited conclusion (`research_probably_enough`, `looks_good`). */
export function isConclusionName(name: string): boolean {
  const lower = name.toLowerCase();
  if (/(^|_)looks_good(_|$)/.test(lower)) return true;
  return lower.split(/_+/).some((t) => CONCLUSION_TOKENS.has(t));
}

/** A literal value that reads like a conclusion ('probably enough', 'looks good'). */
export function isConclusionText(text: string): boolean {
  return /\b(probably|likely|seems|looks good|good enough|sufficient|enough)\b/i.test(text);
}

/** Field names that suggest a transcript or unbounded history (§IV.A). */
export function isTranscriptName(name: string): boolean {
  return /(^|_)(transcript|history|messages|conversation|chat|chat_log|log|logs|thread)(_|$)/.test(
    name,
  );
}
