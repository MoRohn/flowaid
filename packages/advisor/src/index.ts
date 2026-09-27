/**
 * `@flowaid/advisor` (UPGRADE_PLAN P6-02): the cost optimizer, the AI workflow builder and the
 * critic. Pure: statistics, generation and decisions are passed in, so the API decides which
 * providers and credentials they use.
 */
export type {
  Advice,
  AdviceCategory,
  AdviceSeverity,
  AdvisorModel,
  EvalSignal,
  ManifestLookup,
  NodeStats,
  PriceCatalog,
  Risk,
  Suggestion,
  SuggestionKind,
} from "./types.js";
export { optimize, type OptimizeInput } from "./optimize.js";
export { formatUsd, suggestionDiagnostics } from "./suggestions.js";
export { RUBRIC, piiInputs, type CritiqueInput, type RubricRule } from "./rubric.js";
export { CRITIC_CHECKS, critique, workflowSummary, type Judge } from "./critic.js";
export {
  catalogForPrompt,
  compactDefinitionSchema,
  generateWorkflow,
  systemPrompt,
  type GenerateWorkflowInput,
  type GeneratedWorkflow,
} from "./builder.js";
