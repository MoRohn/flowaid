/**
 * @flowaid/nodes-core — the built-in node package (ARCHITECTURE.md §3, §6.3): typed decisions,
 * generation, HTTP, data, developer, state and safety nodes. The manifest of every node is built to
 * `dist/manifest.json` (exported as `@flowaid/nodes-core/manifest`).
 */
import { definePackage, type AnyNodeDefinition, type NodePackage } from "@flowaid/node-sdk";
import { booleanNode } from "./decision/boolean.js";
import { choiceNode } from "./decision/choice.js";
import { scoreNode } from "./decision/score.js";
import { batchNode } from "./decision/batch.js";
import { confidenceGateNode } from "./decision/confidence_gate.js";
import { routerNode } from "./decision/router.js";
import { consensusNode } from "./decision/consensus.js";
import { validatorNode } from "./decision/validator.js";
import { generateNode } from "./ai/generate.js";
import { structuredGenerateNode } from "./ai/structured_generate.js";
import { embeddingsNode } from "./ai/embeddings.js";
import { httpNode } from "./tools/http.js";
import { mcpNode } from "./tools/mcp.js";
import { mcpResourceNode } from "./tools/mcp_resource.js";
import { mcpPromptNode } from "./tools/mcp_prompt.js";
import { openapiNode } from "./tools/openapi.js";
import { codeNode } from "./tools/code.js";
import { shellNode } from "./tools/shell.js";
import { transformNode } from "./data/transform.js";
import { templateNode } from "./data/template.js";
import { jsonNode } from "./data/json.js";
import { schemaValidateNode } from "./data/schema_validate.js";
import { mergeNode } from "./data/merge.js";
import { filterNode } from "./data/filter.js";
import { mapNode } from "./data/map.js";
import { splitNode } from "./data/split.js";
import { extractNode } from "./data/extract.js";
import { logNode } from "./dev/log.js";
import { assertNode } from "./dev/assert.js";
import { mockNode } from "./dev/mock.js";
import { metricNode } from "./dev/metric.js";
import { stateGetNode } from "./state/get.js";
import { stateSetNode } from "./state/set.js";
import { guardNode } from "./safety/guard.js";
import { moderationNode } from "./safety/moderation.js";
import { piiDetectorNode } from "./safety/pii_detector.js";
import { graphqlNode } from "./tools/graphql.js";
import { dbQueryNode } from "./tools/db_query.js";
import { promptNode } from "./ai/prompt.js";
import { rerankNode } from "./ai/rerank.js";
import { chunkerNode, embedNode, loaderNode, upsertNode } from "./retrieval/ingest.js";
import {
  hybridSearchNode,
  knowledgeBaseNode,
  retrievalRerankNode,
  retrieverNode,
} from "./retrieval/search.js";
import {
  pageindexCiteNode,
  pageindexIndexNode,
  pageindexRetrieveNode,
} from "./retrieval/pageindex.js";
import { visionNode } from "./ai/vision.js";
import { speechNode } from "./ai/speech.js";
import { imageNode } from "./ai/image.js";
import { agentNode } from "./ai/agent.js";
import { policyCheckNode } from "./safety/policy_check.js";
import { rateLimitNode } from "./safety/rate_limit.js";
import { permissionCheckNode } from "./safety/permission_check.js";
import { testNode } from "./dev/test.js";
import { debugNode } from "./dev/debug.js";
import { traceNode } from "./dev/trace.js";
import { sessionNode } from "./state/session.js";
import { checkpointNode } from "./state/checkpoint.js";

export {
  booleanNode,
  choiceNode,
  scoreNode,
  batchNode,
  confidenceGateNode,
  routerNode,
  consensusNode,
  validatorNode,
  generateNode,
  structuredGenerateNode,
  embeddingsNode,
  httpNode,
  mcpNode,
  mcpResourceNode,
  mcpPromptNode,
  openapiNode,
  codeNode,
  shellNode,
  transformNode,
  templateNode,
  jsonNode,
  schemaValidateNode,
  mergeNode,
  filterNode,
  mapNode,
  splitNode,
  extractNode,
  logNode,
  assertNode,
  mockNode,
  metricNode,
  stateGetNode,
  stateSetNode,
  guardNode,
  moderationNode,
  piiDetectorNode,
  graphqlNode,
  dbQueryNode,
  promptNode,
  rerankNode,
  visionNode,
  speechNode,
  imageNode,
  agentNode,
  policyCheckNode,
  rateLimitNode,
  permissionCheckNode,
  testNode,
  debugNode,
  traceNode,
  sessionNode,
  checkpointNode,
  pageindexIndexNode,
  pageindexRetrieveNode,
  pageindexCiteNode,
};
export { dbQueryConnector, type DbQueryNetwork } from "./tools/db_query.js";
export { gateOutcome, type GateOutcome } from "./decision/confidence_gate.js";
export { combine } from "./decision/consensus.js";
export { splitText } from "./data/split.js";
export { detectPii, redactPii, PII_KINDS, type PiiFinding, type PiiKind } from "./safety/pii.js";
export { extractJson } from "./ai/structured_generate.js";
export {
  AGENT_LIMITS,
  AGENT_PRESET_BUILTIN,
  APPROVAL_MODES,
  UNTRUSTED_NOTICE,
  agentSettingsSchema,
  effectiveAgent,
  needsApproval,
  type AgentSettings,
  type AgentState,
  type ApprovalMode,
} from "./ai/agent.js";
export { DOCUMENT_TOOL_NAMES } from "./ai/agentDocuments.js";
export {
  BUILTIN_AGENT_TOOLS,
  CALCULATOR_TOOL,
  CURRENT_TIME_TOOL,
  WEB_FETCH_TOOL,
  isBuiltinAgentTool,
} from "./tools/builtins/definitions.js";
export { evaluateArithmetic, runBuiltinTool, type BuiltinToolDeps } from "./tools/builtins/run.js";
export { indexEventName } from "./retrieval/pageindex.js";

/** Every core node, in palette order. */
export const CORE_NODES: readonly AnyNodeDefinition[] = [
  booleanNode,
  choiceNode,
  scoreNode,
  batchNode,
  confidenceGateNode,
  routerNode,
  consensusNode,
  validatorNode,
  generateNode,
  structuredGenerateNode,
  embeddingsNode,
  promptNode,
  visionNode,
  speechNode,
  imageNode,
  agentNode,
  rerankNode,
  loaderNode,
  chunkerNode,
  embedNode,
  upsertNode,
  retrieverNode,
  hybridSearchNode,
  retrievalRerankNode,
  knowledgeBaseNode,
  pageindexIndexNode,
  pageindexRetrieveNode,
  pageindexCiteNode,
  httpNode,
  mcpNode,
  mcpResourceNode,
  mcpPromptNode,
  openapiNode,
  codeNode,
  shellNode,
  graphqlNode,
  dbQueryNode,
  transformNode,
  templateNode,
  jsonNode,
  schemaValidateNode,
  mergeNode,
  filterNode,
  mapNode,
  splitNode,
  extractNode,
  logNode,
  assertNode,
  mockNode,
  metricNode,
  testNode,
  debugNode,
  traceNode,
  stateGetNode,
  stateSetNode,
  sessionNode,
  checkpointNode,
  guardNode,
  moderationNode,
  piiDetectorNode,
  policyCheckNode,
  rateLimitNode,
  permissionCheckNode,
] as readonly AnyNodeDefinition[];

/** The package's release and the node SDK range it targets (kept current by `pnpm version-packages`). */
export const PACKAGE_VERSION = "0.10.0";
export const SDK_RANGE = "^0.10.0";

export const coreNodes: NodePackage = definePackage({
  name: "@flowaid/nodes-core",
  version: PACKAGE_VERSION,
  nodes: CORE_NODES,
  sdk: SDK_RANGE,
});

export default coreNodes;
