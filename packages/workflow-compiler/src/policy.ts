/**
 * Node policy resolution: workflow default ← manifest default ← node override, field by field
 * (ARCHITECTURE.md §4.1 pass 8). The manifest's `defaultPolicy` is a partial NodePolicy.
 */
import {
  NodePolicySchema,
  type NodePolicy,
  type NodeManifest,
  type ResolvedNodePolicy,
  type WorkflowDefinition,
  type WorkflowNode,
} from "@flowaid/workflow-core";
import { cloneJson } from "./util.js";

const PartialNodePolicySchema = NodePolicySchema.partial();

function manifestDefaults(manifest: NodeManifest | undefined): Partial<NodePolicy> {
  if (!manifest) return {};
  const parsed = PartialNodePolicySchema.safeParse(manifest.defaultPolicy);
  if (!parsed.success) return {};
  // `partial()` keeps the inner default of onError; only honour what the manifest actually set.
  const policy: Partial<NodePolicy> = { ...parsed.data };
  if (!Object.hasOwn(manifest.defaultPolicy, "onError")) delete policy.onError;
  return policy;
}

export function resolvePolicy(
  definition: WorkflowDefinition,
  node: WorkflowNode,
  manifest: NodeManifest | undefined,
): ResolvedNodePolicy {
  const workflow = definition.execution;
  const fromManifest = manifestDefaults(manifest);
  const own = node.policy;
  return {
    timeoutMs: own?.timeoutMs ?? fromManifest.timeoutMs ?? workflow.defaultNodeTimeoutMs,
    retry: cloneJson(own?.retry ?? fromManifest.retry ?? workflow.defaultRetry),
    onError: own?.onError ?? fromManifest.onError ?? "fail",
    maxCostUsd: own?.maxCostUsd ?? fromManifest.maxCostUsd ?? null,
    maxTokens: own?.maxTokens ?? fromManifest.maxTokens ?? null,
    privacy: cloneJson(own?.privacy ?? fromManifest.privacy ?? workflow.privacy),
  };
}
