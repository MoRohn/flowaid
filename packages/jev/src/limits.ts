/**
 * TypeSafe System One limits (docs/design/TYPESAFE_API.md, verified live 2026-09-22) and the
 * flowaid token estimator (ARCHITECTURE.md §6.3, JEV_ENGINEERING.md §5.4, Appendix A).
 */

/** Hard and default limits applied to every contract, packet and request. */
export const TYPESAFE_LIMITS = Object.freeze({
  /** Choice: at most 255 options including escapes. */
  maxChoiceOptions: 255,
  /** Choice: a closed menu needs at least two outcomes to be a decision. */
  minChoiceOptions: 2,
  /** Score: 2..10 ordered level descriptions. */
  minScoreLevels: 2,
  maxScoreLevels: 10,
  /** Tokens per request (state + every question). */
  maxRequestTokens: 64_000,
  /** Tokens for state plus the longest question. */
  maxStatePlusQuestionTokens: 32_000,
  /** flowaid ceiling for `StateSpec.maxTokens`, leaving ≥ 2 000 tokens for the longest question. */
  maxPacketTokens: 30_000,
  /** flowaid default compactness budget of a packet. */
  defaultPacketTokens: 8_000,
  /** Requests per minute (token bucket in the provider). */
  requestsPerMinute: 1_200,
  /** Input price in USD per million tokens; output is free. */
  inputPricePerMTokUsd: 0.042,
});

/** Characters per estimated token (flowaid estimator, the same as the provider guard). */
export const CHARS_PER_TOKEN = 3.5;

/** Choice option keys accepted by the TypeSafe wire and usable as control ports. */
export const CHOICE_KEY_RE = /^[a-z][a-z0-9_]{0,63}$/;

/** Estimated tokens of a text: `ceil(chars / 3.5)`. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/** Estimated input cost in USD for a number of tokens at the catalog price. */
export function estimateCostUsd(tokens: number): number {
  return (tokens * TYPESAFE_LIMITS.inputPricePerMTokUsd) / 1_000_000;
}
