/**
 * Pass 7 — environment (ARCHITECTURE.md §4.1). Runs only when earlier passes found no errors.
 * Provider and model availability, failover hops, secret bindings, unused declarations and the
 * cost bound. Availability and bindings are errors at publish and warnings at draft.
 */
import type { ProviderHop } from "@flowaid/workflow-core";
import type { CompileContext, NodeInfo } from "../context.js";
import { nodePath } from "../diagnostics.js";
import { isPlainObject } from "../util.js";

/** The provider a hop needs configured (`llm` hops need their model's provider). */
function hopProvider(hop: ProviderHop): string | null {
  switch (hop.provider) {
    case "typesafe":
      return "typesafe";
    case "llm":
      return hop.model.provider;
    case "custom":
      return hop.id;
    case "rule":
    case "human":
      return null;
  }
}

function hopLabel(hop: ProviderHop): string {
  switch (hop.provider) {
    case "typesafe":
      return `typesafe/${hop.model}`;
    case "llm":
      return `${hop.model.provider}/${hop.model.model}`;
    case "custom":
      return `custom:${hop.id}`;
    case "rule":
    case "human":
      return hop.provider;
  }
}

/** The decision chain in effect: the definition's, or the workspace default when it is untouched. */
export function decisionChain(ctx: CompileContext): {
  primary: ProviderHop;
  failover: ProviderHop[];
} {
  const own = ctx.definition.execution.decisions;
  const untouched =
    own.primary.provider === "typesafe" &&
    own.primary.model === "jev-latest" &&
    own.failover.length === 0;
  if (untouched && ctx.options.defaultDecisions) return ctx.options.defaultDecisions;
  return { primary: own.primary, failover: own.failover };
}

export function environmentPass(ctx: CompileContext): void {
  const { options, diagnostics, definition } = ctx;
  const publish = options.level === "publish";
  const decisionNodes = ctx.active().filter((n) => n.manifest?.decision !== undefined);

  if (options.providers) {
    const available = options.providers;
    const unavailable = (what: string, info: NodeInfo | null, path: string) =>
      diagnostics.add(publish ? "E_PROVIDER_UNAVAILABLE" : "W_PROVIDER_UNAVAILABLE", what, {
        ...(info ? { nodeId: info.node.id } : {}),
        path,
      });
    if (decisionNodes.length > 0) {
      const chain = decisionChain(ctx);
      const primary = hopProvider(chain.primary);
      if (primary !== null && !available.providers.has(primary)) {
        unavailable(
          `Decisions use ${hopLabel(chain.primary)}, but '${primary}' is not configured in this workspace`,
          null,
          "/execution/decisions/primary",
        );
      }
      chain.failover.forEach((hop, i) => {
        const provider = hopProvider(hop);
        if (provider !== null && !available.providers.has(provider)) {
          diagnostics.add(
            "W_FAILOVER_UNCONFIGURED",
            `Failover hop ${i + 1} (${hopLabel(hop)}) is not configured and will be skipped`,
            { path: `/execution/decisions/failover/${i}` },
          );
        }
      });
    }
    for (const info of ctx.active()) {
      if (info.node.kind !== "task" || !info.manifest?.generation) continue;
      const model = info.node.config.model;
      if (
        !isPlainObject(model) ||
        typeof model.provider !== "string" ||
        typeof model.model !== "string"
      )
        continue;
      const path = nodePath(info.index, "config", "model");
      if (!available.providers.has(model.provider)) {
        unavailable(
          `'${info.node.id}' uses ${model.provider}, which is not configured in this workspace`,
          info,
          path,
        );
        continue;
      }
      const entry = available.models.find(
        (m) => m.provider === model.provider && m.model === model.model,
      );
      if (entry?.deprecated) {
        diagnostics.add(
          "W_MODEL_DEPRECATED",
          `${model.provider}/${model.model} is deprecated: ${entry.deprecated}`,
          { nodeId: info.node.id, path },
        );
      }
    }
  }

  if (options.boundSecrets) {
    const bound = options.boundSecrets;
    definition.secrets.forEach((secret, i) => {
      if (!ctx.usedSecrets.has(secret.name) || bound.has(secret.name)) return;
      if (!secret.required) return;
      diagnostics.add(
        publish ? "E_SECRET_UNBOUND" : "W_SECRET_UNBOUND",
        `Secret '${secret.name}' is not bound to a credential in this environment`,
        { path: `/secrets/${i}` },
      );
    });
  }

  definition.secrets.forEach((secret, i) => {
    if (!ctx.usedSecrets.has(secret.name)) {
      diagnostics.add(
        "W_SECRET_UNUSED",
        `Secret '${secret.name}' is declared but no node uses it`,
        {
          path: `/secrets/${i}`,
        },
      );
    }
  });
  definition.variables.forEach((variable, i) => {
    if (!ctx.usedVariables.has(variable.name)) {
      diagnostics.add("W_VARIABLE_UNUSED", `$vars.${variable.name} is declared but never read`, {
        path: `/variables/${i}`,
      });
    }
  });

  if (costBound(ctx) === null) {
    const spenders = ctx
      .active()
      .filter((n) => n.manifest?.decision !== undefined || n.manifest?.generation);
    if (spenders.length > 0) {
      diagnostics.add(
        "W_COST_ESTIMATE",
        `No cost bound: set execution.maxCostUsd, or maxCostUsd on ${spenders.map((n) => `'${n.node.id}'`).join(", ")}`,
        { path: "/execution" },
      );
    }
  }
}

/** The run's cost ceiling: the workflow bound, else the sum of every AI node's bound, else null. */
export function costBound(ctx: CompileContext): number | null {
  const own = ctx.definition.execution.maxCostUsd;
  if (own !== undefined) return own;
  let total = 0;
  for (const info of ctx.active()) {
    const spends = info.manifest?.decision !== undefined || info.manifest?.generation === true;
    if (!spends) continue;
    const bound = info.node.policy?.maxCostUsd;
    const manifestBound = info.manifest?.defaultPolicy.maxCostUsd;
    const value = bound ?? (typeof manifestBound === "number" ? manifestBound : undefined);
    if (value === undefined) return null;
    total += value;
  }
  return total;
}
