/**
 * The packet builder (JEV_ENGINEERING.md §5.3, handbook §IV): declared fields only, secrets
 * never, data-class policy with redaction against the provider's eligible class, freshness
 * marking, declared minimization (selection, `maxChars`, marked truncation), the seven Table IV
 * sections in canonical order, canonical hashing and the token budget. Pure and deterministic.
 */
import { sha256Hex, stableStringify, type JsonObject, type JsonValue } from "@flowaid/shared";
import type { DataClass } from "@flowaid/workflow-core";
import { estimateTokens } from "../limits.js";
import { toJsonValue } from "../json.js";
import {
  ArtifactItemSchema,
  EvidenceItemSchema,
  StatePacketSchema,
  type ArtifactItem,
  type EvidenceItem,
  type PacketFieldSpec,
  type PacketRole,
  type StatePacket,
  type StateSpec,
} from "./spec.js";

/** Rank of a data class (public 0 … pii 3). */
export function dataClassRank(dc: DataClass): number {
  switch (dc) {
    case "public":
      return 0;
    case "internal":
      return 1;
    case "sensitive":
      return 2;
    case "pii":
      return 3;
  }
}

/** The highest of the given data classes. */
export function maxDataClass(...classes: DataClass[]): DataClass {
  let best: DataClass = "public";
  for (const dc of classes) if (dataClassRank(dc) > dataClassRank(best)) best = dc;
  return best;
}

/** Redaction mode applied to a field. */
export type RedactMode = "mask" | "hash" | "drop";

/** Hooks a caller (node executor, runtime) injects into the builder. */
export interface PacketHooks {
  /** True when a value was produced by an `x-secret` port or is a secret the run's Redactor learned (§5.3 step 2). */
  isSecret?: (field: string, value: JsonValue) => boolean;
  /**
   * Custom redaction of a field value (e.g. a workspace redactor). Return `undefined` to use
   * the built-in mode: mask → `"[REDACTED:<class>]"`, hash → `"sha256:<first 16>"`, drop → excluded.
   */
  redact?: (
    field: string,
    value: JsonValue,
    mode: Exclude<RedactMode, "drop">,
    dataClass: DataClass,
  ) => JsonValue | undefined;
}

/** Options of {@link buildPacket}. */
export interface BuildPacketOptions {
  /** `"<runId>:<scope>@<seq>"` of the snapshot the inputs were resolved from. */
  stateVersion: string;
  /** Highest data class the target provider may receive (§5.6); default `pii` (every class eligible). */
  eligibleClass?: DataClass;
  /** Producer data classes per field (`x-dataClass` of the bound ports); effective class = max(field, producer). */
  producerClasses?: Record<string, DataClass>;
  /** Evaluation time (ISO-8601) used for freshness. */
  now: string;
  /** Formatted refs per field (`start.message`, `fetch.body`) recorded in the report. */
  provenance?: Record<string, string[]>;
  hooks?: PacketHooks;
}

/** Why a field did not enter the packet. */
export type ExcludedReason = "undeclared" | "data_class" | "empty_optional";

/** Human-inspectable account of how a packet was built (§5.3 step 9, §5.5). */
export interface PacketReport {
  included: string[];
  excluded: { field: string; reason: ExcludedReason }[];
  redacted: { field: string; mode: RedactMode; dataClass: DataClass }[];
  truncated: { field: string; originalChars: number; keptChars: number }[];
  stale: { field: string; itemId: string | null; ageMs: number }[];
  droppedEvidenceIds: string[];
  evidenceIds: string[];
  tokens: number;
  maxTokens: number;
  dataClass: DataClass;
  provenance: Record<string, string[]>;
}

/** A built packet: the canonical JSON actually sent, its hash and token estimate. */
export interface BuiltPacket {
  packet: StatePacket;
  /** `stableStringify(packet)` — exactly what is sent. */
  canonical: string;
  /** `sha256Hex(canonical)`. */
  packetHash: string;
  /** `ceil(canonical.length / 3.5)`. */
  tokens: number;
  stateVersion: string;
  report: PacketReport;
}

/** Why the builder refused. Non-retryable except `over_budget` (the graph may narrow evidence). */
export type PacketErrorReason =
  | "secret_value"
  | "required_missing"
  | "invalid_field"
  | "data_class"
  | "ineligible_provider"
  | "field_too_large"
  | "duplicate_evidence_id"
  | "multiple_goals"
  | "over_budget";

export interface PacketError {
  reason: PacketErrorReason;
  field: string | null;
  message: string;
  /** Present for `over_budget`: the estimate of the packet that was refused, and its report. */
  tokens?: number;
  report?: PacketReport;
}

export type BuildPacketResult =
  { ok: true; value: BuiltPacket } | { ok: false; error: PacketError };

/** The marker appended to truncated values (§5.3 step 5). */
export function truncationMarker(droppedChars: number): string {
  return `…[truncated ${droppedChars} chars]`;
}

function fail(reason: PacketErrorReason, field: string | null, message: string): BuildPacketResult {
  return { ok: false, error: { reason, field, message } };
}

function isEmpty(value: JsonValue | undefined): value is undefined | null {
  return value === undefined || value === null;
}

function hashedValue(value: JsonValue): string {
  return `sha256:${sha256Hex(stableStringify(value)).slice(0, 16)}`;
}

/** The item fields the builder needs from evidence and artifact items alike. */
interface PacketItem {
  id: string;
  summary?: string;
}

/** How one item role is parsed, dated and versioned. */
interface ItemRole<T extends PacketItem> {
  parse: (raw: unknown) => T | null;
  observedAt: (item: T) => string | undefined;
  versioned: (item: T) => boolean;
}

const EVIDENCE_ROLE: ItemRole<EvidenceItem> = {
  parse: (raw) => {
    const parsed = EvidenceItemSchema.safeParse(raw);
    return parsed.success ? parsed.data : null;
  },
  observedAt: (item) => item.observedAt,
  versioned: (item) => item.version !== undefined,
};

const ARTIFACT_ROLE: ItemRole<ArtifactItem> = {
  parse: (raw) => {
    const parsed = ArtifactItemSchema.safeParse(raw);
    return parsed.success ? parsed.data : null;
  },
  observedAt: () => undefined,
  versioned: (item) => item.hash !== undefined,
};

function redactItem<T extends PacketItem>(
  item: T,
  mode: Exclude<RedactMode, "drop">,
  dataClass: DataClass,
): T {
  if (item.summary === undefined) return item;
  const summary = mode === "mask" ? `[REDACTED:${dataClass}]` : hashedValue(item.summary);
  return { ...item, summary };
}

interface ItemFieldInput<T extends PacketItem> {
  name: string;
  field: PacketFieldSpec;
  value: JsonValue;
  role: ItemRole<T>;
  redactMode: Exclude<RedactMode, "drop"> | null;
  dataClass: DataClass;
  nowMs: number;
  report: PacketReport;
}

type ItemFieldResult<T> = { ok: true; items: T[] } | { ok: false; error: PacketError };

/** Parses, dates, selects, redacts and bounds the items of one evidence/artifact field (§5.3 steps 4–5). */
function processItems<T extends PacketItem>(input: ItemFieldInput<T>): ItemFieldResult<T> {
  const { name, field, role, report } = input;
  if (!Array.isArray(input.value)) {
    return {
      ok: false,
      error: {
        reason: "invalid_field",
        field: name,
        message: `state field "${name}" (role ${field.role}) must be an array of items`,
      },
    };
  }
  const parsed: T[] = [];
  for (const raw of input.value) {
    const item = role.parse(raw);
    if (item === null) {
      return {
        ok: false,
        error: {
          reason: "invalid_field",
          field: name,
          message: `state field "${name}" holds an item that is not a valid ${field.role} item`,
        },
      };
    }
    parsed.push(item);
  }
  // 4. Freshness: older than maxAgeMs (strictly) or unversioned when a version is required.
  if (field.freshness) {
    for (const item of parsed) {
      const observedText = role.observedAt(item);
      const observed = observedText === undefined ? Number.NaN : Date.parse(observedText);
      const age = Number.isNaN(observed) ? null : Math.max(0, input.nowMs - observed);
      const missingVersion = field.freshness.requireVersion && !role.versioned(item);
      if ((age !== null && age > field.freshness.maxAgeMs) || missingVersion) {
        report.stale.push({ field: name, itemId: item.id, ageMs: age ?? 0 });
      }
    }
  }
  // 5a. Declared selection (order, maxItems) — never ad-hoc truncation.
  let items = parsed;
  if (field.selection) {
    if (field.selection.order === "observed_desc") {
      items = items
        .map((item, index) => {
          const t = role.observedAt(item);
          return { item, index, t: t === undefined ? Number.NEGATIVE_INFINITY : Date.parse(t) };
        })
        .sort((a, b) => (b.t === a.t ? a.index - b.index : b.t > a.t ? 1 : -1))
        .map((x) => x.item);
    }
    if (items.length > field.selection.maxItems) {
      for (const dropped of items.slice(field.selection.maxItems))
        report.droppedEvidenceIds.push(dropped.id);
      items = items.slice(0, field.selection.maxItems);
    }
  }
  const mode = input.redactMode;
  if (mode !== null) items = items.map((item) => redactItem(item, mode, input.dataClass));
  // 5b. maxChars: drop trailing whole items (an item is never cut in half).
  if (field.maxChars !== undefined) {
    const original = serializedChars(toJsonValue(items));
    if (original > field.maxChars) {
      if (field.overflow === "error") {
        return {
          ok: false,
          error: {
            reason: "field_too_large",
            field: name,
            message: `state field "${name}" has ${original} chars, maxChars is ${field.maxChars}`,
          },
        };
      }
      while (items.length > 0 && serializedChars(toJsonValue(items)) > field.maxChars) {
        const last = items[items.length - 1];
        items = items.slice(0, -1);
        if (last) report.droppedEvidenceIds.push(last.id);
      }
      report.truncated.push({
        field: name,
        originalChars: original,
        keptChars: serializedChars(toJsonValue(items)),
      });
    }
  }
  return { ok: true, items };
}

function serializedChars(value: JsonValue): number {
  return stableStringify(value).length;
}

/**
 * Builds the packet for `spec` from the bound values (§5.3). Pure: the same inputs always give
 * the same packet, canonical text, hash and report.
 */
export function buildPacket(
  spec: StateSpec,
  bound: Readonly<Record<string, unknown>>,
  options: BuildPacketOptions,
): BuildPacketResult {
  const eligible = options.eligibleClass ?? "pii";
  const nowMs = Date.parse(options.now);
  if (Number.isNaN(nowMs))
    return fail("invalid_field", null, `now is not an ISO-8601 time: ${options.now}`);

  const report: PacketReport = {
    included: [],
    excluded: [],
    redacted: [],
    truncated: [],
    stale: [],
    droppedEvidenceIds: [],
    evidenceIds: [],
    tokens: 0,
    maxTokens: spec.maxTokens,
    dataClass: "public",
    provenance: {},
  };

  // 1. Declared fields only.
  for (const name of Object.keys(bound).sort()) {
    if (!(name in spec.fields)) report.excluded.push({ field: name, reason: "undeclared" });
  }

  let goal: string | undefined = spec.goal;
  let goalFromField = false;
  const facts: JsonObject = {};
  const constraints: JsonObject = {};
  const optionsSection: JsonObject = {};
  const evidence: EvidenceItem[] = [];
  const artifacts: ArtifactItem[] = [];
  const seenIds = new Set<string>();

  for (const name of Object.keys(spec.fields).sort()) {
    const field: PacketFieldSpec | undefined = spec.fields[name];
    if (!field) continue;
    let value: JsonValue | undefined;
    try {
      const raw = bound[name];
      value = raw === undefined ? undefined : toJsonValue(raw, `/${name}`);
    } catch (error) {
      return fail(
        "invalid_field",
        name,
        `${name}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (isEmpty(value)) {
      if (field.required)
        return fail("required_missing", name, `required state field "${name}" is missing`);
      report.excluded.push({ field: name, reason: "empty_optional" });
      continue;
    }

    // 2. Secrets never.
    if (options.hooks?.isSecret?.(name, value) === true) {
      return fail(
        "secret_value",
        name,
        `state field "${name}" carries a secret value; secrets never enter a packet`,
      );
    }

    // 3. Data-class policy.
    const effective = maxDataClass(
      field.dataClass,
      options.producerClasses?.[name] ?? field.dataClass,
    );
    if (dataClassRank(effective) > dataClassRank(spec.privacyClass)) {
      return fail(
        "data_class",
        name,
        `state field "${name}" carries ${effective} data above the packet's privacy class ${spec.privacyClass}`,
      );
    }
    let redactMode: RedactMode | null = null;
    if (dataClassRank(effective) > dataClassRank(eligible)) {
      if (field.redact === "error") {
        return fail(
          "ineligible_provider",
          name,
          `state field "${name}" (${effective}) exceeds the provider's eligible class ${eligible} and declares redact: 'error'`,
        );
      }
      redactMode = field.redact;
      report.redacted.push({ field: name, mode: field.redact, dataClass: effective });
      if (field.redact === "drop") {
        report.excluded.push({ field: name, reason: "data_class" });
        continue;
      }
    }

    const role: PacketRole = field.role;
    const itemMode = redactMode === "drop" ? null : redactMode;
    if (role === "evidence" || role === "artifact") {
      const ids: string[] = [];
      if (role === "evidence") {
        const result = processItems({
          name,
          field,
          value,
          role: EVIDENCE_ROLE,
          redactMode: itemMode,
          dataClass: effective,
          nowMs,
          report,
        });
        if (!result.ok) return { ok: false, error: result.error };
        for (const item of result.items) {
          evidence.push(item);
          ids.push(item.id);
          report.evidenceIds.push(item.id);
        }
      } else {
        const result = processItems({
          name,
          field,
          value,
          role: ARTIFACT_ROLE,
          redactMode: itemMode,
          dataClass: effective,
          nowMs,
          report,
        });
        if (!result.ok) return { ok: false, error: result.error };
        for (const item of result.items) {
          artifacts.push(item);
          ids.push(item.id);
        }
      }
      for (const id of ids) {
        if (seenIds.has(id))
          return fail(
            "duplicate_evidence_id",
            name,
            `evidence/artifact id "${id}" appears twice in the packet`,
          );
        seenIds.add(id);
      }
      report.included.push(name);
      report.dataClass = maxDataClass(report.dataClass, effective);
      const refs = options.provenance?.[name];
      if (refs) report.provenance[name] = [...refs];
      continue;
    }

    // Scalar / object roles: redaction replaces the value.
    if (redactMode === "mask" || redactMode === "hash") {
      const custom = options.hooks?.redact?.(name, value, redactMode, effective);
      value = custom ?? (redactMode === "mask" ? `[REDACTED:${effective}]` : hashedValue(value));
    }
    // 5c. maxChars with marked truncation.
    if (field.maxChars !== undefined) {
      const text = typeof value === "string" ? value : stableStringify(value);
      if (text.length > field.maxChars) {
        if (field.overflow === "error") {
          return fail(
            "field_too_large",
            name,
            `state field "${name}" has ${text.length} chars, maxChars is ${field.maxChars}`,
          );
        }
        const kept = Math.max(0, field.maxChars - truncationMarker(text.length).length);
        value = `${text.slice(0, kept)}${truncationMarker(text.length - kept)}`;
        report.truncated.push({ field: name, originalChars: text.length, keptChars: kept });
      }
    }

    switch (role) {
      case "goal":
        if (typeof value !== "string")
          return fail("invalid_field", name, `goal field "${name}" must be a string`);
        if (goalFromField || spec.goal !== undefined)
          return fail("multiple_goals", name, "a packet has exactly one goal");
        goal = value;
        goalFromField = true;
        break;
      case "fact":
        facts[name] = value;
        break;
      case "constraint":
        constraints[name] = value;
        break;
      case "option":
        optionsSection[name] = value;
        break;
    }
    report.included.push(name);
    report.dataClass = maxDataClass(report.dataClass, effective);
    const refs = options.provenance?.[name];
    if (refs) report.provenance[name] = [...refs];
  }

  // 6. Assemble the seven sections in canonical order, stateVersion last; omit empty sections.
  const assembled: StatePacket = {
    ...(goal !== undefined ? { goal } : {}),
    ...(Object.keys(facts).length > 0 ? { facts } : {}),
    ...(artifacts.length > 0 ? { artifacts } : {}),
    ...(evidence.length > 0 ? { evidence } : {}),
    ...(Object.keys(constraints).length > 0 ? { constraints } : {}),
    ...(Object.keys(optionsSection).length > 0 ? { options: optionsSection } : {}),
    stateVersion: options.stateVersion,
  };
  const checked = StatePacketSchema.safeParse(assembled);
  if (!checked.success) {
    return fail(
      "invalid_field",
      null,
      `assembled packet is invalid: ${checked.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
    );
  }

  // 7. Canonicalize and hash.
  const canonical = stableStringify(toJsonValue(assembled));
  const packetHash = sha256Hex(canonical);
  const tokens = estimateTokens(canonical);
  report.tokens = tokens;

  // 8. Budget — never silent truncation.
  if (tokens > spec.maxTokens) {
    return {
      ok: false,
      error: {
        reason: "over_budget",
        field: null,
        message: `packet is ${tokens} estimated tokens, the contract's budget is ${spec.maxTokens}`,
        tokens,
        report,
      },
    };
  }
  return {
    ok: true,
    value: {
      packet: assembled,
      canonical,
      packetHash,
      tokens,
      stateVersion: options.stateVersion,
      report,
    },
  };
}

/** The packet hash of an arbitrary TypeSafe state (legacy nodes send `state` verbatim, §12.2). */
export function statePacketHash(state: unknown): string {
  return sha256Hex(stableStringify(toJsonValue(state)));
}
