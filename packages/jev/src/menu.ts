/**
 * Live option menus (JEV_ENGINEERING.md §10, handbook §VIII).
 *
 * Menus are runtime state derived immediately before evaluation (§VIII.A). `buildOptionSet`
 * turns a runtime list of candidates into the choice criteria of a dynamic-menu contract:
 * deterministic exclusion (`keep`), eligibility (data class, budget), dedupe by id, shortlist,
 * the `maxOptions` cap with an explicit overflow strategy, model-facing key normalisation
 * (`o1…oN` or slugs; candidate ids never reach the model), required and distinct descriptions,
 * escapes appended ALWAYS (even when nothing survived), ≤ 255 entries, a content `version` and
 * the counts that let a failure be assigned to filtering, shortlisting or semantic choice.
 */
import { z } from "zod";
import type { JsonValue } from "@flowaid/shared";
import { JsonValueSchema } from "@flowaid/workflow-core";
import {
  EscapeKindSchema,
  JEV_RESERVED_PORTS,
  OutcomeKeySchema,
  type DecisionContractBody,
  type DynamicMenu,
} from "./contract.js";
import { hashJson, toJsonValue } from "./json.js";
import { TYPESAFE_LIMITS } from "./limits.js";
import { HashSchema, type OptionSetRef } from "./wire.js";

export const OptionEntrySchema = z.object({
  key: OutcomeKeySchema, // model-facing key (ordinal o1…oN or slug); never the raw candidate id
  sourceId: z.string().max(512), // candidate id — returned to the graph in `selection.sourceId`
  label: z.string().max(200).optional(),
  description: z.string().min(1).max(2000), // distinguishing evidence conditions (§VIII.F)
  escape: EscapeKindSchema.optional(), // escapes come from the contract, never from candidates
  observedAt: z.iso.datetime().optional(),
  data: JsonValueSchema.optional(), // the candidate itself (for `selection.item`); persisted redacted
});
export type OptionEntry = z.infer<typeof OptionEntrySchema>;

export const OptionSetCountsSchema = z.object({
  original: z.int().min(0),
  kept: z.int().min(0),
  eligible: z.int().min(0),
  shortlisted: z.int().min(0),
  final: z.int().min(0),
});
export type OptionSetCounts = z.infer<typeof OptionSetCountsSchema>;

export const OptionSetSchema = z.object({
  version: HashSchema, // sha256Json(entries minus data/observedAt) — the option-set version (§VIII.H)
  entries: z.array(OptionEntrySchema).min(1).max(255),
  counts: OptionSetCountsSchema,
  builtAt: z.iso.datetime(),
  builtAtSeq: z.int().min(0),
});
export type OptionSet = z.infer<typeof OptionSetSchema>;

/** How a candidate list is turned into options. Accessors are plain functions (the menu node compiles FlowExpr lambdas into them). */
export interface OptionSetBuilderConfig<T> {
  /** Stable candidate id (worker id, control id, model `provider:model`, document id). */
  id: (candidate: T) => string;
  /** Evidence conditions under which this candidate is the correct branch — distinguishing, never praise. */
  description: (candidate: T) => string;
  label?: (candidate: T) => string | undefined;
  /** Deterministic exclusion: availability, enabled/visible, permissions (§VIII.B). */
  keep?: (candidate: T) => boolean;
  /** Eligibility by code (§VII.G): data-class trust, provider policy. */
  eligible?: (candidate: T) => boolean;
  /** Budget: drop candidates whose cost exceeds the remaining budget. */
  cost?: { by: (candidate: T) => number; remainingUsd: number };
  /** Shortlist by a score (descending, stable), keeping at most `topK`. */
  shortlist?: { by: (candidate: T) => number; topK: number };
  /** When the candidate was observed (freshness of the option data). */
  observedAt?: (candidate: T) => string | undefined;
  /** The candidate payload returned in `selection.item`; default: the candidate itself when it is JSON. */
  data?: (candidate: T) => JsonValue | undefined;
  /**
   * More options than `maxOptions` after the shortlist: `truncate` keeps the first `maxOptions`
   * (shortlist order) and lists the rest; `error` refuses to build.
   */
  overflow?: "truncate" | "error";
}

/** Why an option set could not be built. */
export interface OptionSetError {
  reason: "empty_description" | "duplicate_description" | "overflow" | "invalid_key" | "limit";
  message: string;
  sourceIds: string[];
}

/** What happened to each candidate, for the menu-builder tests (§VIII.D, §10.5). */
export interface OptionSetReport {
  duplicates: string[];
  excluded: string[];
  ineligible: string[];
  overBudget: string[];
  notShortlisted: string[];
  truncated: string[];
  /** Only escapes are left (`empty` port fires; the decision can still choose stop/review). */
  empty: boolean;
}

export type BuildOptionSetResult =
  | { ok: true; optionSet: OptionSet; report: OptionSetReport }
  | { ok: false; error: OptionSetError };

/** Maximum slug length before collision suffixes (§10.2 step 5). */
export const SLUG_MAX = 48;

/**
 * Normalises a candidate id into a model-facing key: lower-case `[a-z0-9_]`, starting with a
 * letter, ≤ 48 characters. Collisions (with other keys, reserved routing ports or escape keys)
 * are resolved by the caller with `_2`, `_3`, … ({@link assignKeys}).
 */
export function optionKey(id: string): string {
  let slug = id
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (slug === "" || !/^[a-z]/.test(slug)) slug = `o_${slug}`.replace(/_+$/g, "");
  if (slug === "o") slug = "o_option";
  return slug.slice(0, SLUG_MAX).replace(/_+$/g, "");
}

/** Keys for the given ids under a strategy, unique and never equal to a reserved port or an escape key. */
export function assignKeys(
  ids: readonly string[],
  strategy: DynamicMenu["keyStrategy"],
  escapeKeys: readonly string[],
): string[] {
  const taken = new Set<string>([...JEV_RESERVED_PORTS, ...escapeKeys, "stop", "yes", "no"]);
  const keys: string[] = [];
  ids.forEach((id, index) => {
    let base = strategy === "ordinal" ? `o${index + 1}` : optionKey(id);
    if (strategy === "ordinal" && taken.has(base)) base = `o_${index + 1}`;
    let key = base;
    let n = 2;
    while (taken.has(key)) {
      key = `${base}_${n}`;
      n += 1;
    }
    taken.add(key);
    keys.push(key);
  });
  return keys;
}

/** The option-set version: `sha256Json(entries minus data/observedAt)`. */
export function optionSetVersion(entries: readonly OptionEntry[]): string {
  return hashJson(entries.map(({ data: _data, observedAt: _observedAt, ...rest }) => rest));
}

function normalizedDescription(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

/** The dynamic menu of a contract, or null for static menus and other kinds. */
export function dynamicMenuOf(body: DecisionContractBody): DynamicMenu | null {
  const q = body.question;
  return q.kind === "choice" && q.menu.source === "dynamic" ? q.menu : null;
}

/**
 * Builds a live option set for a dynamic menu (§10.2). Pure: equal candidates, config and time
 * give an equal set and version.
 */
export function buildOptionSet<T>(
  menu: DynamicMenu,
  candidates: readonly T[],
  config: OptionSetBuilderConfig<T>,
  at: { builtAt: string; builtAtSeq: number },
): BuildOptionSetResult {
  const report: OptionSetReport = {
    duplicates: [],
    excluded: [],
    ineligible: [],
    overBudget: [],
    notShortlisted: [],
    truncated: [],
    empty: false,
  };
  // 1. original
  const original = candidates.length;
  // Dedupe by id (first wins) — the same worker listed twice is one option.
  const seen = new Set<string>();
  const unique: { candidate: T; id: string }[] = [];
  for (const candidate of candidates) {
    const id = config.id(candidate);
    if (seen.has(id)) {
      report.duplicates.push(id);
      continue;
    }
    seen.add(id);
    unique.push({ candidate, id });
  }
  // 2. Deterministic exclusion.
  const kept = unique.filter(({ candidate, id }) => {
    const keep = config.keep ? config.keep(candidate) : true;
    if (!keep) report.excluded.push(id);
    return keep;
  });
  // 3. Eligibility (trust, budget).
  const eligible = kept.filter(({ candidate, id }) => {
    if (config.eligible && !config.eligible(candidate)) {
      report.ineligible.push(id);
      return false;
    }
    if (config.cost && config.cost.by(candidate) > config.cost.remainingUsd) {
      report.overBudget.push(id);
      return false;
    }
    return true;
  });
  // 4. Shortlist (stable by score desc), then the maxOptions cap.
  let shortlisted = eligible;
  if (config.shortlist) {
    const { by, topK } = config.shortlist;
    const ranked = eligible
      .map((entry, index) => ({ entry, index, score: by(entry.candidate) }))
      .sort((a, b) => (b.score === a.score ? a.index - b.index : b.score > a.score ? 1 : -1));
    shortlisted = ranked.slice(0, topK).map((r) => r.entry);
    for (const r of ranked.slice(topK)) report.notShortlisted.push(r.entry.id);
  }
  let live = shortlisted;
  if (live.length > menu.maxOptions) {
    if ((config.overflow ?? "truncate") === "error") {
      return {
        ok: false,
        error: {
          reason: "overflow",
          message: `${live.length} options survive the shortlist but the contract allows ${menu.maxOptions}`,
          sourceIds: live.slice(menu.maxOptions).map((e) => e.id),
        },
      };
    }
    for (const e of live.slice(menu.maxOptions)) report.truncated.push(e.id);
    live = live.slice(0, menu.maxOptions);
  }
  // 5. Keys and descriptions.
  const escapeKeys = Object.keys(menu.escapes);
  const keys = assignKeys(
    live.map((e) => e.id),
    menu.keyStrategy,
    escapeKeys,
  );
  const entries: OptionEntry[] = [];
  const descriptions = new Map<string, string>();
  for (const [i, { candidate, id }] of live.entries()) {
    const description = config.description(candidate).trim();
    if (description === "") {
      return {
        ok: false,
        error: {
          reason: "empty_description",
          message: `candidate "${id}" has no description; the menu would be under-specified`,
          sourceIds: [id],
        },
      };
    }
    const norm = normalizedDescription(description);
    const clash = descriptions.get(norm);
    if (clash !== undefined) {
      return {
        ok: false,
        error: {
          reason: "duplicate_description",
          message: `candidates "${clash}" and "${id}" share a description; options must be distinguishable`,
          sourceIds: [clash, id],
        },
      };
    }
    descriptions.set(norm, id);
    const key = keys[i];
    if (key === undefined || !OutcomeKeySchema.safeParse(key).success) {
      return {
        ok: false,
        error: {
          reason: "invalid_key",
          message: `no valid key for candidate "${id}"`,
          sourceIds: [id],
        },
      };
    }
    let data: JsonValue | undefined;
    try {
      data = config.data ? config.data(candidate) : toJsonValue(candidate);
    } catch {
      data = undefined;
    }
    const label = config.label?.(candidate);
    const observedAt = config.observedAt?.(candidate);
    entries.push({
      key,
      sourceId: id,
      description,
      ...(label !== undefined ? { label } : {}),
      ...(observedAt !== undefined ? { observedAt } : {}),
      ...(data !== undefined ? { data } : {}),
    });
  }
  // 6. Escapes, always.
  for (const [key, spec] of Object.entries(menu.escapes)) {
    entries.push({
      key,
      sourceId: `escape:${key}`,
      description: spec.description,
      escape: spec.escape,
    });
  }
  report.empty = live.length === 0;
  if (entries.length > TYPESAFE_LIMITS.maxChoiceOptions) {
    return {
      ok: false,
      error: {
        reason: "limit",
        message: `${entries.length} entries exceed the ${TYPESAFE_LIMITS.maxChoiceOptions}-option limit`,
        sourceIds: [],
      },
    };
  }
  // 7. Version and counts.
  const optionSet: OptionSet = {
    version: optionSetVersion(entries),
    entries,
    counts: {
      original,
      kept: kept.length,
      eligible: eligible.length,
      shortlisted: shortlisted.length,
      final: live.length,
    },
    builtAt: at.builtAt,
    builtAtSeq: at.builtAtSeq,
  };
  return { ok: true, optionSet: OptionSetSchema.parse(optionSet), report };
}

/** The choice criteria (key → description) of an option set, escapes included. */
export function optionSetCriteria(optionSet: OptionSet): Record<string, string> {
  const criteria: Record<string, string> = {};
  for (const e of optionSet.entries) criteria[e.key] = e.description;
  return criteria;
}

/** What the decide node returns in `selection` for a chosen key (null for escapes and unknown keys). */
export function resolveSelection(
  optionSet: OptionSet,
  key: string,
): { key: string; sourceId: string; item: JsonValue | null } | null {
  const entry = optionSet.entries.find((e) => e.key === key);
  if (!entry || entry.escape !== undefined) return null;
  return { key: entry.key, sourceId: entry.sourceId, item: entry.data ?? null };
}

/** Age of an option set at evaluation time, in ms (never negative). */
export function optionSetAgeMs(optionSet: OptionSet, now: string): number {
  return Math.max(0, Date.parse(now) - Date.parse(optionSet.builtAt));
}

/**
 * §10.3: an option set is stale when older than the menu's `maxAgeMs` or built at a sequence
 * number below the decision inputs' own snapshot.
 */
export function isOptionSetStale(
  optionSet: OptionSet,
  menu: Pick<DynamicMenu, "maxAgeMs">,
  now: string,
  inputsSeq?: number,
): boolean {
  if (optionSetAgeMs(optionSet, now) > menu.maxAgeMs) return true;
  return inputsSeq !== undefined && optionSet.builtAtSeq < inputsSeq;
}

/** The receipt's `OptionSetRef` of a live option set. */
export function optionSetRef(optionSet: OptionSet, now: string | null): OptionSetRef {
  return {
    version: optionSet.version,
    source: "dynamic",
    size: optionSet.entries.length,
    escapeKeys: optionSet.entries.filter((e) => e.escape !== undefined).map((e) => e.key),
    counts: { ...optionSet.counts },
    ageMs: now === null ? null : optionSetAgeMs(optionSet, now),
  };
}

/** The receipt's `OptionSetRef` of a static menu (version = hash of its outcome keys and descriptions). */
export function staticOptionSetRef(body: DecisionContractBody): OptionSetRef | null {
  const q = body.question;
  if (q.kind !== "choice" || q.menu.source !== "static") return null;
  const entries: OptionEntry[] = Object.entries(q.menu.outcomes).map(([key, spec]) => ({
    key,
    sourceId: key,
    description: spec.description,
    ...(spec.escape !== undefined ? { escape: spec.escape } : {}),
  }));
  return {
    version: optionSetVersion(entries),
    source: "static",
    size: entries.length,
    escapeKeys: entries.filter((e) => e.escape !== undefined).map((e) => e.key),
    counts: null,
    ageMs: null,
  };
}
