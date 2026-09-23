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
};
export { gateOutcome, type GateOutcome } from "./decision/confidence_gate.js";
export { combine } from "./decision/consensus.js";
export { splitText } from "./data/split.js";
export { detectPii, redactPii, PII_KINDS, type PiiFinding, type PiiKind } from "./safety/pii.js";
export { extractJson } from "./ai/structured_generate.js";

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
  httpNode,
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
] as readonly AnyNodeDefinition[];

export const coreNodes: NodePackage = definePackage({
  name: "@flowaid/nodes-core",
  version: "0.1.0",
  nodes: CORE_NODES,
  sdk: "^0.1.0",
});

export default coreNodes;
