/**
 * Identity helpers: contract labels (`support.router@4`, JEV_ENGINEERING.md §4.1) and state
 * versions (`<runId>:<scope>@<seq>`, §8.1).
 */
import { ScopePathSchema } from "@flowaid/workflow-core";
import { ContractKeySchema } from "./wire.js";

/** A parsed contract label. */
export interface ContractLabel {
  key: string;
  version: number;
}

/** `support.router@4`. */
export function contractLabel(key: string, version: number): string {
  return `${key}@${version}`;
}

/** Parses `key@version`; `null` when the key or version is invalid. */
export function parseContractLabel(label: string): ContractLabel | null {
  const at = label.lastIndexOf("@");
  if (at <= 0) return null;
  const key = label.slice(0, at);
  const versionText = label.slice(at + 1);
  if (!/^[1-9]\d{0,8}$/.test(versionText)) return null;
  if (!ContractKeySchema.safeParse(key).success) return null;
  return { key, version: Number(versionText) };
}

/** The parts of a state version. */
export interface StateVersionParts {
  runId: string;
  /** Scope path (`""` for the root scope, `loop_x#3/each_y#0` inside containers). */
  scope: string;
  /** `NODE_SCHEDULED.seq` whose reduced state the packet was built from. */
  seq: number;
}

/** `"<runId>:<scope>@<seq>"` — the exact evaluated snapshot (§8.1). */
export function formatStateVersion(parts: StateVersionParts): string {
  if (!Number.isInteger(parts.seq) || parts.seq < 0) {
    throw new RangeError(`stateVersion seq must be a non-negative integer, got ${parts.seq}`);
  }
  if (parts.runId.includes(":")) throw new RangeError("stateVersion runId must not contain ':'");
  if (!ScopePathSchema.safeParse(parts.scope).success) {
    throw new RangeError(`stateVersion scope is not a scope path: ${parts.scope}`);
  }
  return `${parts.runId}:${parts.scope}@${parts.seq}`;
}

/** Parses a state version; `null` when malformed. */
export function parseStateVersion(text: string): StateVersionParts | null {
  const colon = text.indexOf(":");
  const at = text.lastIndexOf("@");
  if (colon <= 0 || at < colon) return null;
  const runId = text.slice(0, colon);
  const scope = text.slice(colon + 1, at);
  const seqText = text.slice(at + 1);
  if (!/^(0|[1-9]\d*)$/.test(seqText)) return null;
  if (!ScopePathSchema.safeParse(scope).success) return null;
  return { runId, scope, seq: Number(seqText) };
}

/**
 * Decision lineage for the blind-retry guard (§6.5): the node id plus the scope path with
 * iteration indices removed, so every iteration of a loop shares one lineage.
 */
export function lineageOf(nodeId: string, scope: string): string {
  const stripped = scope.replace(/#\d+/g, "");
  return stripped === "" ? nodeId : `${stripped}/${nodeId}`;
}
