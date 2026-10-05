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
  /** the card's few words when not ready, in place of "to set up" */
  state?: string;
  /** the page that sets it up, when it is not ready */
  where?: "credentials" | "integrations" | "knowledge";
}

export interface WorkspaceResources {
  keys: KeySources;
  mcpServers: number;
  /** the workspace's knowledge sources, by kind */
  knowledge: readonly { kind: string }[];
  /** the PageIndex service is configured (`features.pageindex`) */
  pageindex: boolean;
}

const docs = (key: string) => (key === "documents" ? "Documents" : `Documents (${key})`);

/**
 * The kind of knowledge source a template's slot takes: PDFs indexed with PageIndex (the slot
 * says so: its steps navigate section trees), or a source of chunks any other kind fills.
 */
export function slotSourceKind(slot: { description?: string }): "pageindex" | "chunks" {
  return /pageindex/i.test(slot.description ?? "") ? "pageindex" : "chunks";
}

/** The sources that can fill a knowledge slot. */
export function sourcesForSlot<T extends { kind: string }>(
  slot: { description?: string },
  sources: readonly T[],
): T[] {
  const wanted = slotSourceKind(slot);
  return sources.filter((s) => (s.kind === "pageindex") === (wanted === "pageindex"));
}

export function templateNeeds(t: TemplateRow, have: WorkspaceResources): TemplateNeed[] {
  const needs: TemplateNeed[] = [];
  const secrets = t.requiredSecrets ?? [];
  const typeCount = new Map<string, number>();
  for (const { credentialType: type } of secrets)
    if (type) typeCount.set(type, (typeCount.get(type) ?? 0) + 1);
  for (const secret of secrets) {
    if (!secret.credentialType) continue;
    const required = secret.required !== false;
    // two secrets of one kind (two bearer tokens) are told apart by their names
    const label =
      credentialTypeLabel(secret.credentialType) +
      ((typeCount.get(secret.credentialType) ?? 0) > 1 ? ` for ${secret.name}` : "");
    const source = keySource(secret.credentialType, have.keys, required);
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
                state: "bind it after creating",
                detail: `saved as a credential; after creating, bind it to ${secret.name} under Settings → Secrets`,
              }
            : {
                label,
                ready: false,
                state: "to set up",
                where: "credentials",
                detail: `save it under Credentials, then bind it to ${secret.name} under Settings → Secrets, or set the key in the server's environment`,
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
            where: "integrations",
          },
    );
  for (const k of t.requiredResources?.knowledgeSources ?? []) {
    const pageindex = slotSourceKind(k) === "pageindex";
    const fits = sourcesForSlot(k, have.knowledge).length;
    needs.push(
      pageindex && !have.pageindex
        ? {
            label: docs(k.key),
            ready: false,
            state: "PageIndex is off",
            detail:
              "needs PDFs indexed with PageIndex, which is turned off on this server: start FlowAId with --pageindex",
          }
        : fits > 0
          ? {
              label: docs(k.key),
              ready: true,
              detail: "choose which source when you create it",
            }
          : {
              label: docs(k.key),
              ready: false,
              detail: pageindex
                ? "add a PageIndex source with indexed PDFs under Knowledge"
                : "add a source of documents (not PageIndex) under Knowledge",
              where: "knowledge",
            },
    );
  }
  return needs;
}

export interface TemplateCheck {
  id: string;
  /** warnings never stop creating the copy: the builder shows what is still missing */
  state: "ok" | "warning" | "info";
  label: string;
  detail: string;
  where?: TemplateNeed["where"];
}

/**
 * The key a slot's choice is sent under in `POST /v1/workflows {resources}`: an MCP server by its
 * key, a knowledge source as `knowledge.<key>` (the API resolves `$template.<kind>.<key>` either way).
 */
export const pickKey = (slot: { key: string; kind: "mcpServers" | "knowledgeSources" }): string =>
  slot.kind === "knowledgeSources" ? `knowledge.${slot.key}` : slot.key;

/**
 * The Use template dialog's readiness list: the template's needs against the workspace, and the
 * MCP servers and knowledge sources chosen for its slots so far. `ready` is true when a run of the
 * new copy has what FlowAId can check for; it says nothing about whether its answers suit your
 * cases.
 */
export function templateChecks(
  needs: readonly TemplateNeed[],
  slots: readonly { key: string; kind: "mcpServers" | "knowledgeSources" }[],
  picked: Readonly<Record<string, string>>,
  nameOf: (id: string) => string | undefined,
): { checks: TemplateCheck[]; ready: boolean } {
  // once servers or sources exist, the need becomes the question of which one this copy uses
  const slotOf = (n: TemplateNeed) =>
    n.ready
      ? slots.find((x) =>
          x.kind === "mcpServers" ? n.label === `MCP server (${x.key})` : n.label === docs(x.key),
        )
      : undefined;
  const checks: TemplateCheck[] = needs.map((n) => {
    const slot = slotOf(n);
    if (!slot)
      return {
        id: `need:${n.label}`,
        state: n.ready ? "ok" : "warning",
        label: n.label,
        detail: n.detail,
        ...(n.where ? { where: n.where } : {}),
      };
    const id = picked[pickKey(slot)];
    const what = slot.kind === "mcpServers" ? "MCP server" : "knowledge source";
    return id
      ? {
          id: `slot:${slot.key}`,
          state: "ok",
          label: `${slot.kind === "mcpServers" ? "MCP server" : "Knowledge source"} for ${slot.key}: ${nameOf(id) ?? "chosen"}`,
          detail:
            slot.kind === "mcpServers"
              ? "its tools are wired into the copy"
              : "the steps that read documents search it",
        }
      : {
          id: `slot:${slot.key}`,
          state: "warning",
          label: `No ${what} chosen for ${slot.key}`,
          detail:
            "choose one in the next step, or later in the builder; steps that use it fail until then",
        };
  });
  return { checks, ready: checks.every((c) => c.state !== "warning") };
}
