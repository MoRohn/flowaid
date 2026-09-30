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
  builderPromptHash,
  catalogForPrompt,
  compactDefinitionSchema,
  generateWorkflow,
  systemPrompt,
  type GenerateWorkflowInput,
  type GeneratedWorkflow,
} from "./builder.js";
export {
  ASSISTANT_SYSTEM_PROMPT,
  ask,
  assistantPromptHash,
  type AskInput,
  type AssistantAnswer,
  type AssistantSource,
  type AssistantStatement,
  type AssistantTool,
  type AssistantToolResult,
  type SourceKind,
  type StatementKind,
} from "./assistant.js";
export {
  ASSISTANT_EVAL_CASES,
  fixtureTools,
  formatEvalReport,
  runAssistantEval,
  scoreCase,
  type AssistantEvalCase,
  type CaseResult,
  type EvalReport,
} from "./evals/assistant.js";
export {
  SAMPLE_INPUTS_SYSTEM_PROMPT,
  sampleInputs,
  sampleInputsContext,
  sampleInputsPromptHash,
  type SampleInput,
  type SampleInputsRequest,
  type SampleInputsResult,
  type SampleScenario,
} from "./sampleInputs.js";
