/**
 * The publish dialog's review: whether the draft can be published (the compiler's diagnostics,
 * whether anything changed, required secrets in the environments ticked for deploying) and what
 * pressing Publish will do. Every check comes from real state; nothing here publishes.
 */
import type { WorkflowDiff } from "@flowaid/workflow-compiler";
import type { Diagnostic } from "@flowaid/workflow-core";
import type { Check } from "~/guide/Readiness";

export interface PublishReviewInput {
  diagnostics: readonly Diagnostic[];
  /** the latest published version number: null before the first publish, undefined if unknown */
  latestVersion: number | null | undefined;
  /** the compiler's diff against the latest version; null while loading or unavailable */
  changes: WorkflowDiff | null;
  comparing: boolean;
  /** environments ticked to deploy to, with their required secrets still unbound (undefined: unknown) */
  deployTo: readonly { name: string; missingSecrets: readonly string[] | undefined }[];
  /** the evaluation gate, when one is chosen */
  gate: { setName: string; minPassRate: number } | null;
}

/** How many things the diff changes (layout moves are not counted). */
export function changeCount(d: WorkflowDiff): number {
  return (
    d.nodes.added.length +
    d.nodes.removed.length +
    d.nodes.changed.length +
    d.edges.added.length +
    d.edges.removed.length +
    [d.inputs, d.outputs, d.variables, d.secrets, d.execution, d.document].filter(
      (p) => p.length > 0,
    ).length
  );
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function publishChecks(p: PublishReviewInput): Check[] {
  const checks: Check[] = [];
  const errors = p.diagnostics.filter((d) => d.severity === "error").length;
  const warnings = p.diagnostics.filter((d) => d.severity === "warning").length;
  checks.push(
    errors > 0
      ? {
          id: "compile",
          state: "blocker",
          label: `${plural(errors, "error")} to fix in the draft`,
          detail: "They are listed below; Show node closes this dialog and opens the step.",
        }
      : warnings > 0
        ? {
            id: "compile",
            state: "warning",
            label: `No errors, ${plural(warnings, "warning")}`,
            detail:
              "Warnings do not stop publishing. Read them: each is something that may go wrong when it runs.",
          }
        : { id: "compile", state: "ok", label: "The draft compiles without errors" },
  );

  if (p.latestVersion === null)
    checks.push({ id: "changes", state: "info", label: "This will be the first version, v1" });
  else if (p.comparing)
    checks.push({ id: "changes", state: "checking", label: "Comparing with the latest version" });
  else if (p.changes && p.latestVersion !== undefined) {
    const n = changeCount(p.changes);
    checks.push(
      n > 0
        ? {
            id: "changes",
            state: "ok",
            label: `${plural(n, "change")} since v${p.latestVersion}`,
          }
        : p.changes.layoutOnly
          ? {
              id: "changes",
              state: "info",
              label: `Only the layout moved since v${p.latestVersion}`,
              detail: "It still publishes as a new version, but runs will behave the same.",
            }
          : {
              id: "changes",
              state: "blocker",
              label: `Nothing changed since v${p.latestVersion}`,
              detail:
                "The server refuses to publish an identical version. Deploy that version instead.",
            },
    );
  }

  for (const e of p.deployTo) {
    if (e.missingSecrets === undefined) continue;
    checks.push(
      e.missingSecrets.length > 0
        ? {
            id: `secrets:${e.name}`,
            state: "blocker",
            label: `Required secrets not bound in ${e.name}: ${e.missingSecrets.join(", ")}`,
            detail: `Bind them under Settings, Secrets, or untick ${e.name} and deploy later.`,
          }
        : { id: `secrets:${e.name}`, state: "ok", label: `Secrets bound in ${e.name}` },
    );
  }

  if (p.gate)
    checks.push({
      id: "gate",
      state: "info",
      label: `Needs an evaluation on ${p.gate.setName} of at least ${Math.round(p.gate.minPassRate * 100)}%`,
      detail:
        "The server looks for a completed evaluation of this exact draft on that set and refuses to publish without one. Publishing does not run it: run it first under Evaluations.",
    });

  return checks;
}

/** What pressing Publish does, in order. */
export function publishOutcome(
  latestVersion: number | null | undefined,
  deployTo: readonly string[],
): string[] {
  const next =
    latestVersion === null
      ? "v1"
      : latestVersion === undefined
        ? "the new version"
        : `v${latestVersion + 1}`;
  return [
    "Saves the draft, then the server compiles it again with the strictest checks.",
    `Freezes it as ${next}. That version never changes; you keep editing the draft.`,
    deployTo.length
      ? `Deploys ${next} to ${deployTo.join(" and ")} straight away: webhooks and schedules there switch to it, and runs already going finish on their version.`
      : `Deploys nothing: ${next} runs nowhere until you deploy it from the Deployments page.`,
    "Starts no runs.",
  ];
}
