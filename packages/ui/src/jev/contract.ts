/**
 * Pure helpers over a decision contract body (JEV_ENGINEERING.md §4.2, §13.2):
 * the schema limits and semantic validation the editor shows inline, with the
 * diagnostic code each message maps to. The authoritative implementation is
 * `lintContract` in `@flowaid/jev`; this mirror lets the presentational editor
 * validate as the author types, with the same limits and wording.
 */
import type {
  ConfigurableConsequence,
  ConsequenceClass,
  JevContractBody,
  JevContractQuestion,
  JevOutcomeSpec,
  JevZoneThresholds,
} from "./types";
import {
  CONFIGURABLE_CONSEQUENCES,
  ILLUSTRATIVE_THRESHOLDS,
  JEV_LIMITS,
  consequenceRank,
  contractLabel,
} from "./vocabulary";

export type ContractIssueSeverity = "error" | "warning";

export interface ContractIssue {
  /** Jev diagnostic code (§13.2); schema violations are `E_JEV_CONTRACT_INVALID`. */
  code: string;
  severity: ContractIssueSeverity;
  /** JSON pointer into the contract body. */
  path: string;
  message: string;
}

/** Routing port names a contract outcome may not use (§4.2). */
export const JEV_RESERVED_PORTS: ReadonlySet<string> = new Set([
  "done",
  "failed",
  "improve",
  "human",
  "legacy",
  "selected",
]);

const CONTRACT_KEY_RE = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*){0,4}$/;
const PORT_RE = /^[a-z][a-z0-9_]{0,63}$/;
const FIELD_RE = /^[a-z][a-z0-9_]{0,63}$/;
const CAPABILITY_RE = /^[a-z0-9_-]+\.[a-z0-9_*.-]+$/;
const VAGUE_PREDICATES = ["safe", "good", "ok", "okay", "appropriate", "valid", "fine", "correct"];

function words(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 0);
}

/** Token Jaccard similarity of two descriptions (words longer than two characters). */
export function descriptionSimilarity(a: string, b: string): number {
  const sa = new Set(words(a).filter((w) => w.length > 2));
  const sb = new Set(words(b).filter((w) => w.length > 2));
  if (sa.size === 0 && sb.size === 0) return 1;
  let inter = 0;
  for (const w of sa) if (sb.has(w)) inter += 1;
  const union = sa.size + sb.size - inter;
  return union === 0 ? 0 : inter / union;
}

/** Outcome specs of a choice question (static outcomes, or a dynamic menu's escapes). */
export function contractOutcomes(question: JevContractQuestion): Record<string, JevOutcomeSpec> {
  if (question.kind !== "choice") return {};
  return question.menu.source === "static" ? question.menu.outcomes : question.menu.escapes;
}

/** Escape keys the contract declares. */
export function escapeKeys(question: JevContractQuestion): string[] {
  return Object.entries(contractOutcomes(question))
    .filter(([, spec]) => spec.escape !== undefined)
    .map(([key]) => key);
}

/** Every consequence class the contract's outcomes and bands can reach, contract default first. */
export function reachableConsequences(body: JevContractBody): ConsequenceClass[] {
  const set = new Set<ConsequenceClass>([body.routing.consequenceClass]);
  const q = body.question;
  if (q.kind === "choice") {
    for (const spec of Object.values(contractOutcomes(q)))
      if (spec.consequenceClass) set.add(spec.consequenceClass);
  } else if (q.kind === "score") {
    for (const band of q.bands ?? []) if (band.consequenceClass) set.add(band.consequenceClass);
  } else {
    if (q.outcomes.true.consequenceClass) set.add(q.outcomes.true.consequenceClass);
    if (q.outcomes.false.consequenceClass) set.add(q.outcomes.false.consequenceClass);
  }
  return [...set].sort((a, b) => consequenceRank(a) - consequenceRank(b));
}

/** Count of options sent to Jev for a static menu, or `maxOptions + escapes` for a dynamic one. */
export function menuSize(question: JevContractQuestion): number {
  if (question.kind !== "choice") return 0;
  return question.menu.source === "static"
    ? Object.keys(question.menu.outcomes).length
    : question.menu.maxOptions + Object.keys(question.menu.escapes).length;
}

/** Card meta row: `support.router@4 · 5 outcomes · low` (UI addendum §17). */
export function contractSummary(body: JevContractBody): string {
  const q = body.question;
  const shape =
    q.kind === "choice"
      ? q.menu.source === "static"
        ? `${Object.keys(q.menu.outcomes).length} outcomes`
        : `live menu ≤ ${q.menu.maxOptions} + ${Object.keys(q.menu.escapes).length} escapes`
      : q.kind === "score"
        ? `${q.levels.length} levels${q.bands ? ` · ${q.bands.length} bands` : ""}`
        : "yes / no";
  return `${contractLabel(body)} · ${shape} · ${body.routing.consequenceClass}`;
}

/** Validation of one class's zones; the schema's refine message is kept verbatim. */
export function validateZones(t: JevZoneThresholds): string | null {
  const inRange = (v: number | null | undefined) =>
    v === null || v === undefined || (Number.isFinite(v) && v >= 0 && v <= 1);
  if (!inRange(t.autoAt) || !inRange(t.improveAt) || !inRange(t.minMargin))
    return "Thresholds must be between 0 and 1.";
  if (t.autoAt !== null && t.improveAt !== null && t.improveAt > t.autoAt)
    return "improveAt must be ≤ autoAt";
  return null;
}

/**
 * Schema limits plus the §4.2 semantic validation and the contract-level lints
 * of §13.2 (heuristics are warnings). Ordered by path.
 */
export function validateContract(body: JevContractBody): ContractIssue[] {
  const issues: ContractIssue[] = [];
  const err = (path: string, message: string, code = "E_JEV_CONTRACT_INVALID") =>
    issues.push({ code, severity: "error", path, message });
  const warn = (path: string, code: string, message: string) =>
    issues.push({ code, severity: "warning", path, message });

  // Identity -----------------------------------------------------------------
  if (body.key.length > 96 || !CONTRACT_KEY_RE.test(body.key))
    err("/key", "Key must be dotted snake_case with at most five segments, e.g. support.router.");
  if (!Number.isInteger(body.version) || body.version < 1)
    err("/version", "Version must be a positive integer.");
  if (body.title.trim().length === 0) err("/title", "Title is required.");
  else if (body.title.length > 120) err("/title", "Title must be at most 120 characters.");
  if (body.purpose.trim().length === 0)
    err(
      "/purpose",
      "Purpose is required: name the branch this contract controls and why it is semantic.",
    );
  else if (body.purpose.length > 2000) err("/purpose", "Purpose must be at most 2000 characters.");
  if (body.owner.trim().length === 0) err("/owner", "An accountable owner is required.");
  if (body.version > 1 && body.changelog.trim().length === 0)
    err(
      "/changelog",
      "Explain what changes in behaviour and why (required for every version after the first).",
    );

  // Question -----------------------------------------------------------------
  const q = body.question;
  const instructions = q.instructions.trim();
  if (instructions.length === 0)
    err("/question/instructions", "Instructions are required: write the operational definition.");
  else if (q.instructions.length > 8000)
    err("/question/instructions", "Instructions must be at most 8000 characters.");
  else {
    const w = words(instructions);
    const vague = w.some((x) => VAGUE_PREDICATES.includes(x));
    const restates =
      w.join("_") === body.key.split(".").pop() ||
      instructions.toLowerCase() === body.title.toLowerCase();
    if (w.length < 8 && (vague || restates))
      warn(
        "/question/instructions",
        "W_JEV_INSTRUCTIONS_WEAK",
        "Instructions are short and vague: state the evidence conditions the answer depends on (identifiers are not instructions).",
      );
  }

  if (q.kind === "choice") {
    const outcomes = contractOutcomes(q);
    const base = q.menu.source === "static" ? "/question/menu/outcomes" : "/question/menu/escapes";
    const entries = Object.entries(outcomes);
    for (const [key, spec] of entries) {
      const path = `${base}/${key}`;
      if (!PORT_RE.test(key))
        err(
          path,
          `Outcome key "${key}" must be snake_case, start with a letter and be at most 64 characters.`,
        );
      else if (JEV_RESERVED_PORTS.has(key)) err(path, `"${key}" is a reserved routing port name.`);
      const desc = spec.description.trim();
      if (desc.length === 0)
        err(
          `${path}/description`,
          `Choice criteria are required: describe the evidence that selects "${key}".`,
        );
      else if (spec.description.length > 2000)
        err(`${path}/description`, "Descriptions must be at most 2000 characters.");
      else if (words(desc).length < 4)
        warn(
          `${path}/description`,
          "W_JEV_OPTIONS_UNDISTINGUISHED",
          `The description of "${key}" is under four words: state the evidence conditions that distinguish it.`,
        );
      if (spec.escape === "stop" && key !== "stop")
        err(path, 'The stop escape must be keyed "stop" so its routing port is stop.');
    }
    const stops = entries.filter(([, s]) => s.escape === "stop").length;
    if (stops > 1) err(base, "A menu may declare at most one stop escape.");
    for (let i = 0; i < entries.length; i++) {
      for (let j = i + 1; j < entries.length; j++) {
        const a = entries[i];
        const b = entries[j];
        if (!a || !b) continue;
        if (
          a[1].description.trim() &&
          b[1].description.trim() &&
          descriptionSimilarity(a[1].description, b[1].description) >= 0.8
        )
          warn(
            `${base}/${b[0]}/description`,
            "W_JEV_OPTIONS_UNDISTINGUISHED",
            `"${a[0]}" and "${b[0]}" have near-duplicate descriptions; distinguish them or add a review/none escape.`,
          );
      }
    }
    if (q.menu.source === "static") {
      const n = entries.length;
      if (n < 2 || n > JEV_LIMITS.maxChoiceOptions)
        err(
          base,
          `A choice needs 2–${JEV_LIMITS.maxChoiceOptions} outcomes including escapes (TypeSafe accepts at most 255 options); this menu has ${n}.`,
          "E_JEV_MENU_LIMIT",
        );
      if (!entries.some(([, s]) => s.escape !== undefined))
        warn(
          base,
          "W_JEV_NO_ESCAPE_HATCH",
          "No escape outcome: add none, other, stop or review for cases the menu cannot express.",
        );
    } else {
      const escapes = entries.length;
      if (escapes === 0)
        err(
          base,
          "A dynamic menu needs at least one escape outcome (e.g. stop and review).",
          "E_JEV_DYNAMIC_MENU_NO_ESCAPE",
        );
      if (!Number.isInteger(q.menu.maxOptions) || q.menu.maxOptions < 1 || q.menu.maxOptions > 254)
        err("/question/menu/maxOptions", "maxOptions must be between 1 and 254.");
      else if (q.menu.maxOptions + escapes > JEV_LIMITS.maxChoiceOptions)
        err(
          "/question/menu/maxOptions",
          `maxOptions + escapes must be ≤ ${JEV_LIMITS.maxChoiceOptions} (TypeSafe choice limit); it is ${q.menu.maxOptions + escapes}.`,
          "E_JEV_MENU_LIMIT",
        );
      if (!Number.isInteger(q.menu.maxAgeMs) || q.menu.maxAgeMs < 1)
        err("/question/menu/maxAgeMs", "maxAgeMs must be a positive integer.");
    }
  } else if (q.kind === "score") {
    const n = q.levels.length;
    if (n < JEV_LIMITS.minScoreLevels || n > JEV_LIMITS.maxScoreLevels)
      err(
        "/question/levels",
        `A score takes 2–10 ordered level descriptions (TypeSafe criteria); this rubric has ${n}.`,
      );
    else if (n < 3 || n > 5)
      warn("/question/levels", "W_JEV_RUBRIC_LEVELS", `Prefer 3–5 levels; this rubric has ${n}.`);
    q.levels.forEach((level, i) => {
      const t = level.trim();
      const path = `/question/levels/${i}`;
      if (t.length === 0) err(path, `Level ${i} needs a description.`);
      else if (level.length > 2000)
        err(path, "Level descriptions must be at most 2000 characters.");
      else if (
        /^[\d\s.,%/-]+$/.test(t) ||
        words(t).length === 1 ||
        (i > 0 && t.toLowerCase() === (q.levels[i - 1] ?? "").trim().toLowerCase())
      )
        warn(
          path,
          "W_JEV_RUBRIC_ANCHORS",
          `Level ${i} is not an observable verbal anchor: describe the evidence at this level.`,
        );
    });
    if (q.bands) {
      if (q.bands.length < 2 || q.bands.length > 10)
        err("/question/bands", "Declare 2–10 bands, or none to route by confidence only.");
      const cover = new Array<number>(n).fill(0);
      q.bands.forEach((band, i) => {
        const path = `/question/bands/${i}`;
        if (!PORT_RE.test(band.port) || JEV_RESERVED_PORTS.has(band.port))
          err(`${path}/port`, `Band port "${band.port}" is not a valid outcome port.`);
        if (band.minLevel > band.maxLevel) err(path, "minLevel must be ≤ maxLevel.");
        for (let l = band.minLevel; l <= band.maxLevel; l++) {
          if (l < 0 || l >= n) {
            err(
              path,
              `Band ${band.port} covers level ${l}, outside 0–${n - 1}.`,
              "E_JEV_THRESHOLDS_UNMAPPED",
            );
            break;
          }
          cover[l] = (cover[l] ?? 0) + 1;
        }
      });
      const gaps = cover.flatMap((c, l) => (c === 0 ? [l] : []));
      const overlaps = cover.flatMap((c, l) => (c > 1 ? [l] : []));
      if (gaps.length > 0)
        err(
          "/question/bands",
          `Bands must cover every level exactly once; level ${gaps.join(", ")} is unmapped.`,
          "E_JEV_THRESHOLDS_UNMAPPED",
        );
      if (overlaps.length > 0)
        err(
          "/question/bands",
          `Bands overlap at level ${overlaps.join(", ")}.`,
          "E_JEV_THRESHOLDS_UNMAPPED",
        );
    }
  } else {
    if (q.outcomes.true.description.trim().length === 0)
      err(
        "/question/outcomes/true/description",
        "Describe the evidence for yes (sent as the noul criteria).",
      );
    if (q.outcomes.false.description.trim().length === 0)
      err(
        "/question/outcomes/false/description",
        "Describe the evidence for no (sent as the noul criteria).",
      );
    if (!Number.isFinite(q.yesAt) || q.yesAt < 0 || q.yesAt > 1)
      err("/question/yesAt", "yesAt must be between 0 and 1.");
  }

  // Fallback -----------------------------------------------------------------
  if (body.fallbackOutcome !== null && !escapeKeys(q).includes(body.fallbackOutcome))
    err(
      "/fallbackOutcome",
      `Fallback "${body.fallbackOutcome}" must be an escape outcome of the menu, or empty (⇒ human).`,
    );

  // Routing ------------------------------------------------------------------
  const r = body.routing;
  for (const cc of CONFIGURABLE_CONSEQUENCES) {
    const t = r.thresholds[cc];
    if (!t) continue;
    const m = validateZones(t);
    if (m) err(`/routing/thresholds/${cc}`, m);
    if (t.improveAt !== null && !r.improve)
      warn(
        `/routing/thresholds/${cc}/improveAt`,
        "W_JEV_IMPROVE_UNWIRED",
        `The ${cc} class declares an improve zone but the contract names no improve action: that zone would route human.`,
      );
  }
  const reachable = reachableConsequences(body);
  const missing: ConfigurableConsequence[] = CONFIGURABLE_CONSEQUENCES.filter(
    (c) => reachable.includes(c) && !r.thresholds[c],
  );
  if (missing.length > 0)
    warn(
      "/routing/thresholds",
      "W_JEV_THRESHOLDS_ILLUSTRATIVE",
      `No zones for ${missing.join(", ")}: the illustrative Table V defaults apply.`,
    );
  const canAuto = CONFIGURABLE_CONSEQUENCES.some(
    (c) => reachable.includes(c) && (r.thresholds[c] ?? ILLUSTRATIVE_THRESHOLDS[c]).autoAt !== null,
  );
  const governed =
    r.governance &&
    r.governance.approvedBy !== null &&
    r.governance.evaluationWindow.source !== "illustrative";
  if (canAuto && !governed)
    warn(
      "/routing/governance",
      "W_JEV_THRESHOLDS_ILLUSTRATIVE",
      "Auto zones are ungoverned: protected environments need an owner, rationale, evaluation window and approval.",
    );
  if (r.improve) {
    if (r.improve.actions.length === 0)
      err("/routing/improve/actions", "Name at least one action that changes the evidence.");
    r.improve.actions.forEach((a, i) => {
      if (a.description.trim().length === 0)
        err(`/routing/improve/actions/${i}/description`, "Say how the state will improve.");
      else if (a.description.length > 500)
        err(`/routing/improve/actions/${i}/description`, "At most 500 characters.");
    });
    if (
      !Number.isInteger(r.improve.maxRounds) ||
      r.improve.maxRounds < 1 ||
      r.improve.maxRounds > 5
    )
      err("/routing/improve/maxRounds", "maxRounds must be between 1 and 5.");
  }
  if (r.governance && r.governance.rationale.trim().length === 0)
    err("/routing/governance/rationale", "Governance needs a rationale.");
  if (r.uncalibratedProviders === "allow" && body.model.primary.provider !== "typesafe")
    warn(
      "/routing/uncalibratedProviders",
      "W_JEV_UNCALIBRATED_AUTO",
      "A non-TypeSafe primary hop may automate: keep uncalibrated answers on human.",
    );

  // Authority ----------------------------------------------------------------
  const a = body.allowedAction;
  if (a.kinds.length === 0)
    err("/allowedAction/kinds", "Declare at least one allowed action kind.");
  a.capabilities.forEach((c, i) => {
    if (!CAPABILITY_RE.test(c))
      err(
        `/allowedAction/capabilities/${i}`,
        `Capability "${c}" must look like tool.scope, e.g. github.write.`,
      );
  });
  const above = reachable.filter((c) => consequenceRank(c) > consequenceRank(a.maxConsequence));
  if (above.length > 0)
    err(
      "/allowedAction/maxConsequence",
      `maxConsequence (${a.maxConsequence}) is below a reachable outcome class (${above.join(", ")}).`,
    );

  // State spec ---------------------------------------------------------------
  const s = body.state;
  const fields = Object.entries(s.fields);
  if (fields.length < 1 || fields.length > 64) err("/state/fields", "Declare 1–64 state fields.");
  let goals = s.goal !== undefined && s.goal.trim().length > 0 ? 1 : 0;
  for (const [name, f] of fields) {
    const path = `/state/fields/${name}`;
    if (!FIELD_RE.test(name))
      err(path, `Field "${name}" must be snake_case and start with a letter.`);
    if (f.description.trim().length === 0)
      err(
        `${path}/description`,
        `Explain why "${name}" is present; a field nobody can explain fails review.`,
      );
    else if (f.description.length > 500) err(`${path}/description`, "At most 500 characters.");
    if (
      f.maxChars !== undefined &&
      (!Number.isInteger(f.maxChars) || f.maxChars < 1 || f.maxChars > 120_000)
    )
      err(`${path}/maxChars`, "maxChars must be between 1 and 120 000.");
    if (f.role === "goal") goals += 1;
  }
  if (goals > 1) err("/state", "At most one goal: a goal field or the constant goal text.");
  if (
    !Number.isInteger(s.maxTokens) ||
    s.maxTokens < JEV_LIMITS.minPacketTokens ||
    s.maxTokens > JEV_LIMITS.maxPacketTokens
  )
    err(
      "/state/maxTokens",
      `maxTokens must be between ${JEV_LIMITS.minPacketTokens} and ${JEV_LIMITS.maxPacketTokens.toLocaleString("en")} so the longest question still fits TypeSafe's 32k state + question limit.`,
    );

  if (body.escalation.rubric.length > 8000)
    err("/escalation/rubric", "The review rubric must be at most 8000 characters.");

  return issues.sort((x, y) => x.path.localeCompare(y.path));
}

/** Issues whose path is `prefix` or below it. */
export function issuesAt(issues: readonly ContractIssue[], prefix: string): ContractIssue[] {
  return issues.filter((i) => i.path === prefix || i.path.startsWith(`${prefix}/`));
}

/** First error message at exactly `path` (for a FieldRow `error`), else the first warning. */
export function messageAt(
  issues: readonly ContractIssue[],
  path: string,
): { message: string; severity: ContractIssueSeverity } | null {
  const at = issues.filter((i) => i.path === path);
  const pick = at.find((i) => i.severity === "error") ?? at[0];
  return pick ? { message: pick.message, severity: pick.severity } : null;
}
