/**
 * `@flowaid/pageindex`: PageIndex document intelligence (docs/pageindex/ADR.md). The service
 * client (protocol v1), evidence retrieval by navigating a document's section tree with a
 * decision provider, and citation checks. Pure apart from `fetch` in the client.
 */
export {
  DEFAULT_BUDGET,
  evidenceForPrompt,
  retrieveEvidence,
  type Navigator,
  type NavigatorAnswer,
  type NavigatorChoice,
  type RetrievalBudget,
  type RetrieveInput,
} from "./retrieve.js";
export {
  ANSWER_INSTRUCTIONS,
  INSUFFICIENT_MARKER,
  checkCitations,
  claims,
  lexicalSupport,
  type CheckInput,
  type SupportCheck,
  type SupportJudge,
} from "./cite.js";
export {
  LOCAL_CAPABILITIES,
  MODES,
  PAGEINDEX_SDK_VERSION,
  configHash,
  litellmModel,
  type IndexSettings,
} from "./capabilities.js";
export {
  PageIndexSourceConfigSchema,
  StoredIndexSettingsSchema,
  indexRequestFromSource,
  type PageIndexSourceConfig,
  type StoredIndexSettings,
} from "./source.js";
export {
  JobResultSchema,
  JobStateSchema,
  JobStatusSchema,
  PROTOCOL_VERSION,
  PageIndexServiceClient,
  PageIndexServiceError,
  ServiceOutlineNodeSchema,
  frameJob,
  type Health,
  type IndexModelSpec,
  type JobResult,
  type JobState,
  type JobStatus,
  type ServiceClientOptions,
  type ServiceOutlineNode,
  type SubmitJobInput,
} from "./protocol.js";
