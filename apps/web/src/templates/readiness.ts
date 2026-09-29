/**
 * What a template needs before its workflow can run, checked against what the workspace has (pure,
 * so it is unit tested): keys (on the server or saved as credentials), MCP servers and knowledge
 * sources. "Ready" means FlowAId can see the thing exists; a saved credential still has to be
 * bound to the new workflow's secret, which the detail says.
 */
import type { TemplateRow } from "~/admin/types";
import { credentialTypeLabel, keySource, type KeySources } from "~/builder/keySources";

export interface TemplateNeed {
  label: string;
  ready: boolean;
  /** What to do, or why it counts as ready. */
  detail: string;
}

export interface WorkspaceResources {
  keys: KeySources;
  mcpServers: number;
  knowledgeSources: number;
}

const docs = (key: string) => (key === "documents" ? "Documents" : `Documents (${key})`);

export function templateNeeds(t: TemplateRow, have: WorkspaceResources): TemplateNeed[] {
  const needs: TemplateNeed[] = [];
  for (const secret of t.requiredSecrets ?? []) {
    if (!secret.credentialType) continue;
    const required = secret.required !== false;
    const label = credentialTypeLabel(secret.credentialType);
    const source = keySource(secret.credentialType, have.keys, required);
    const serverHasIt = required && keySource(secret.credentialType, have.keys).kind === "server";
    if (!required && source.kind === "missing") continue; // optional and absent: runs without it
    needs.push(
      source.kind === "server"
        ? { label, ready: true, detail: "uses the key set on this server" }
        : source.kind === "none"
          ? { label, ready: true, detail: "no key needed" }
          : source.kind === "saved"
            ? {
                label,
                ready: false,
                detail: `saved as a credential; after creating, bind it to ${secret.name} under Settings → Secrets`,
              }
            : {
                label,
                ready: false,
                detail: `save it under Credentials, then bind it to ${secret.name} under Settings → Secrets${
                  serverHasIt
                    ? " (the key in the server's environment is not used for a required secret)"
                    : ""
                }`,
              },
    );
  }
  for (const m of t.requiredResources?.mcpServers ?? [])
    needs.push(
      have.mcpServers > 0
        ? {
            label: `MCP server (${m.key})`,
            ready: true,
            detail: "choose which one when you create it",
          }
        : {
            label: `MCP server (${m.key})`,
            ready: false,
            detail: "connect one under Integrations",
          },
    );
  for (const k of t.requiredResources?.knowledgeSources ?? [])
    needs.push(
      have.knowledgeSources > 0
        ? { label: docs(k.key), ready: true, detail: "choose the source in the builder" }
        : { label: docs(k.key), ready: false, detail: "add a source under Knowledge" },
    );
  return needs;
}
