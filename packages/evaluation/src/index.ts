/** @flowaid/evaluation — expectations, runner, scorers, summaries and regression reports (ARCHITECTURE.md §10.4). */
export * from "./expectation.js";
export * from "./types.js";
export { jsonEquals, matchValue } from "./scorers/matchers.js";
export { judge, NO_JUDGE_MODEL, type JudgeVerdict } from "./scorers/judge.js";
export { scoreCase, metricsOf, type ScoreOptions } from "./score.js";
export { summarize, calibration, percentile } from "./summarize.js";
export {
  runEvaluation,
  humanResponsesFor,
  type RunEvaluationOptions,
  type EvaluationOutcome,
} from "./runner.js";
export {
  compare,
  deltas,
  flips,
  regressionWarnings,
  REGRESSION_THRESHOLDS,
  type CompareInput,
} from "./compare.js";
export { reportToMarkdown } from "./report.js";
