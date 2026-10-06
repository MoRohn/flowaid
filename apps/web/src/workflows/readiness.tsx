"use client";
/**
 * "What you need" lines for a workflow's own pages: whether each environment has its required
 * secrets bound or answered by a server key (deploys are refused without them) and whether anything is published yet.
 */
import { useQueries } from "@tanstack/react-query";
import type { SecretDecl } from "@flowaid/workflow-core";
import { get } from "~/api/client";
import type { Environment } from "~/api/types";
import { missingRequiredSecrets } from "~/admin/logic";
import { useServerCredentialTypes } from "~/builder/useServerKeys";
import type { Check } from "~/guide/Readiness";
import { useSession } from "~/session";

/** One line per environment; unknown bindings (loading, or no permission to read them) show as checking or are left out. */
export function secretChecks(
  declared: readonly (Pick<SecretDecl, "name" | "required"> & { credentialType?: string })[],
  environments: readonly Pick<Environment, "id" | "name">[],
  bound: (envId: string) => Record<string, string> | undefined,
  {
    ws,
    workflowId,
    loading,
    served = new Set(),
  }: { ws: string; workflowId: string; loading: boolean; served?: ReadonlySet<string> },
): Check[] {
  if (!declared.some((d) => d.required !== false)) {
    // optional secrets are usually a key the server already has (a TypeSafe step's)
    const optional = declared.map((d) => d.name);
    return [
      {
        id: "secrets",
        label: "No required secrets",
        state: "ok",
        detail: optional.length
          ? `${optional.join(", ")} ${optional.length === 1 ? "is" : "are"} optional: a credential you bind under Secrets is used, otherwise the server's key when it has one.`
          : "Steps that need a key declare a secret; none of this workflow's do yet.",
      },
    ];
  }
  return environments.flatMap((e): Check[] => {
    const b = bound(e.id);
    if (!b)
      return loading
        ? [{ id: `secrets:${e.id}`, label: `Secrets in ${e.name}`, state: "checking" }]
        : [];
    const missing = missingRequiredSecrets(declared, b, served);
    return [
      missing.length
        ? {
            id: `secrets:${e.id}`,
            label: `${e.name}: ${missing.join(", ")} not bound`,
            state: "warning",
            detail: `Deploying to ${e.name} is refused until every required secret is bound to a credential, or the server has the key for its type.`,
            fix: (
              <a
                className="text-accent-text hover:underline"
                href={`/${ws}/workflows/${workflowId}/settings?tab=secrets`}
              >
                Bind secrets
              </a>
            ),
          }
        : { id: `secrets:${e.id}`, label: `${e.name}: secrets bound`, state: "ok" },
    ];
  });
}

/** The draft's required secrets checked against each environment's bindings. */
export function useSecretChecks(workflowId: string, declared: readonly SecretDecl[]): Check[] {
  const s = useSession();
  const canRead = s.can("secrets:bind");
  const results = useQueries({
    queries: s.environments.map((e) => ({
      // the same key the Secrets section and the deploy dialog use
      queryKey: ["secret-bindings", s.ws, workflowId, e.id],
      queryFn: () => get<Record<string, string>>(`/v1/workflows/${workflowId}/secrets/${e.id}`),
      enabled: canRead && declared.length > 0,
    })),
  });
  const served = useServerCredentialTypes();
  const byEnv = new Map(s.environments.map((e, i) => [e.id, results[i]?.data]));
  const checks = secretChecks(declared, s.environments, (id) => byEnv.get(id), {
    ws: s.ws,
    workflowId,
    served,
    loading: canRead && results.some((r) => r.isPending),
  });
  return canRead || !declared.length
    ? checks
    : [
        {
          id: "secrets",
          label: "Secret bindings are not visible to your role",
          state: "info",
          detail: "Deploys still check them.",
        },
      ];
}

/** "A published version" as a "What you need" line. */
export function publishedCheck(
  count: number | undefined,
  ws: string,
  workflowId: string,
  need = 1,
): Check {
  if (count === undefined)
    return { id: "published", label: "Published versions", state: "checking" };
  return count >= need
    ? {
        id: "published",
        label: `${count} published version${count === 1 ? "" : "s"}`,
        state: "ok",
      }
    : {
        id: "published",
        label: need === 1 ? "A published version" : `${need} published versions (${count} so far)`,
        state: "blocker",
        detail:
          count === 0
            ? "Publish the draft from the builder's Publish button."
            : "Change the draft and publish it again to have two to compare.",
        fix: (
          <a className="text-accent-text hover:underline" href={`/${ws}/workflows/${workflowId}`}>
            Open the builder
          </a>
        ),
      };
}
