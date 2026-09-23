/**
 * Write-time redaction (ARCHITECTURE.md §5.5, §10.6). Before an event is persisted:
 *
 * - the node's `redact` rules (compiled from `x-dataClass` and `privacy.redactFields`) mask,
 *   hash or drop parts of NODE_STARTED.input and NODE_COMPLETED.output;
 * - a `doNotPersist` node's output is stored as `{ "$redacted": true }` (the run stays correct in
 *   worker memory, but cannot be replayed past that node);
 * - every string of every event is scrubbed of learned secrets (decrypted credentials and
 *   secret environment values).
 *
 * The orchestrator persists the redacted event and keeps the raw one in memory.
 */
import { DROPPED, Redactor } from "@flowaid/credentials";
import type { DurableRunEvent, ExecutionPlan, JsonValue } from "@flowaid/workflow-core";

export function createEventRedactor(
  redactor: Redactor = new Redactor(),
): (event: DurableRunEvent, plan: ExecutionPlan) => DurableRunEvent {
  return (event, plan) => {
    let e = event;
    if (e.type === "NODE_STARTED" || e.type === "NODE_COMPLETED") {
      const node = plan.nodes[e.nodeId];
      if (node) {
        const rules = node.redact;
        if (e.type === "NODE_STARTED" && rules.length > 0) {
          const r = redactor.apply({ in: e.input }, rules);
          e = { ...e, input: r.in ?? null };
        }
        if (e.type === "NODE_COMPLETED") {
          if (node.policy.privacy.doNotPersist) e = { ...e, output: DROPPED };
          else if (rules.length > 0) {
            const r = redactor.apply({ out: e.output }, rules);
            e = { ...e, output: r.out ?? null };
          }
        }
      }
    }
    return redactor.size > 0
      ? (redactor.redactJson(e as unknown as JsonValue) as unknown as DurableRunEvent)
      : e;
  };
}
