/**
 * Contract lint (JEV_ENGINEERING.md §4.2 semantic validation, §13.2 contract-level codes,
 * handbook §III.D "Review the Contract Like Code").
 *
 * `lintContract` parses a contract body, validates it against the TypeSafe limits and the §4.2
 * rules (`E_JEV_CONTRACT_INVALID`, `E_JEV_MENU_LIMIT`, `E_JEV_DYNAMIC_MENU_NO_ESCAPE`,
 * `E_JEV_THRESHOLDS_UNMAPPED`, `E_JEV_PACKET_BUDGET`, `E_JEV_PACKET_DATA_CLASS`) and runs the
 * contract-level lints (escape hatch, distinguishable options, rubric anchors, weak
 * instructions, primitive mismatch, exact rules, free values, transcript/conclusion state,
 * illustrative thresholds, unwired improve zones, uncalibrated auto). Locations are JSON
 * pointers into the contract body. Warnings and infos honour `lintSuppressions`; errors cannot
 * be suppressed.
 */
import type { JsonSchema } from "@flowaid/workflow-core";
import {
  DecisionContractBodySchema,
  escapeOutcomes,
  reachableConsequenceClasses,
  type DecisionContractBody,
} from "../contract.js";
import { compareConsequence } from "../consequence.js";
import { dataClassRank } from "../packet/build.js";
import { questionTokens, toSystemOneQuestion } from "../question.js";
import { CHARS_PER_TOKEN, TYPESAFE_LIMITS } from "../limits.js";
import { jevDiagnostic, type JevDiagnostic, type JevDiagnosticCode } from "../catalog/codes.js";
import {
  describesMultiStepPlan,
  exactRuleMatch,
  freeValueMatch,
  isConclusionName,
  isMultiLabelPhrasing,
  isNumericOnly,
  isPraiseOnly,
  isSeverityPhrasing,
  isTranscriptName,
  isWeakInstruction,
  jaccard,
  ordinalLevelShare,
  words,
} from "./text.js";

/** Options of {@link lintContract}. */
export interface LintContractOptions {
  /**
   * Highest data class each provider hop may receive (`WorkspaceSettings.jev.providerEligibility`,
   * §5.6). Fields above the primary hop's eligibility with `redact: 'error'` are `E_JEV_PACKET_DATA_CLASS`.
   */
  providerEligibility?: Record<string, "public" | "internal" | "sensitive" | "pii">;
}

/** Result of {@link lintContract}: the parsed body (null when the schema rejected it) and findings. */
export interface ContractLintResult {
  body: DecisionContractBody | null;
  diagnostics: JevDiagnostic[];
  /** Diagnostics removed by `lintSuppressions` (kept for review). */
  suppressed: JevDiagnostic[];
  /** No error-severity diagnostic. */
  valid: boolean;
}

function pointer(...segments: (string | number)[]): string {
  return segments.map((s) => `/${String(s).replace(/~/g, "~0").replace(/\//g, "~1")}`).join("");
}

function at(code: JevDiagnosticCode, message: string, path: string): JevDiagnostic {
  return jevDiagnostic(code, message, { path });
}

function isSchemaObject(schema: boolean | JsonSchema | undefined): schema is JsonSchema {
  return typeof schema === "object";
}

/** True when the schema describes an array of `{ role, content }` chat messages. */
function isChatMessageSchema(schema: JsonSchema): boolean {
  const items = schema.items;
  if (!isSchemaObject(items)) return false;
  const props = items.properties;
  return props !== undefined && "role" in props && "content" in props;
}

function typeIncludes(schema: JsonSchema, t: string): boolean {
  const type = schema.type;
  const types: readonly string[] = Array.isArray(type) ? type : type === undefined ? [] : [type];
  return types.includes(t);
}

/* ───────────────────────────── semantic validation (§4.2) ───────────────────────────── */

function semantic(body: DecisionContractBody): JevDiagnostic[] {
  const out: JevDiagnostic[] = [];
  const q = body.question;
  const escapes = escapeOutcomes(body);

  if (q.kind === "choice") {
    if (q.menu.source === "static") {
      const n = Object.keys(q.menu.outcomes).length;
      if (n < TYPESAFE_LIMITS.minChoiceOptions || n > TYPESAFE_LIMITS.maxChoiceOptions) {
        out.push(
          at(
            "E_JEV_MENU_LIMIT",
            `a static menu needs ${TYPESAFE_LIMITS.minChoiceOptions}–${TYPESAFE_LIMITS.maxChoiceOptions} outcomes including escapes, got ${n}`,
            "/question/menu/outcomes",
          ),
        );
      }
    } else {
      const n = Object.keys(q.menu.escapes).length;
      if (n < 1) {
        out.push(
          at(
            "E_JEV_DYNAMIC_MENU_NO_ESCAPE",
            "a dynamic menu needs at least one escape outcome (add `stop` and `review`)",
            "/question/menu/escapes",
          ),
        );
      }
      if (q.menu.maxOptions + n > TYPESAFE_LIMITS.maxChoiceOptions) {
        out.push(
          at(
            "E_JEV_MENU_LIMIT",
            `maxOptions (${q.menu.maxOptions}) + escapes (${n}) exceed ${TYPESAFE_LIMITS.maxChoiceOptions}`,
            "/question/menu/maxOptions",
          ),
        );
      }
    }
    const stops = Object.entries(escapes).filter(([, kind]) => kind === "stop");
    if (stops.length > 1) {
      out.push(
        at("E_JEV_CONTRACT_INVALID", "a menu declares at most one `stop` escape", "/question/menu"),
      );
    }
    for (const [key] of stops) {
      if (key !== "stop") {
        out.push(
          at(
            "E_JEV_CONTRACT_INVALID",
            `the stop escape must be keyed \`stop\` (so its routing port is \`stop\`), got "${key}"`,
            pointer("question", "menu", q.menu.source === "static" ? "outcomes" : "escapes", key),
          ),
        );
      }
    }
  }

  if (q.kind === "score" && q.bands) {
    const n = q.levels.length;
    const covered = new Array<number>(n).fill(0);
    const ports = new Set<string>();
    q.bands.forEach((band, i) => {
      if (ports.has(band.port))
        out.push(
          at(
            "E_JEV_CONTRACT_INVALID",
            `band port "${band.port}" is declared twice`,
            pointer("question", "bands", i, "port"),
          ),
        );
      ports.add(band.port);
      if (band.minLevel > band.maxLevel || band.maxLevel >= n) {
        out.push(
          at(
            "E_JEV_THRESHOLDS_UNMAPPED",
            `band "${band.port}" covers levels ${band.minLevel}..${band.maxLevel}, outside 0..${n - 1}`,
            pointer("question", "bands", i),
          ),
        );
        return;
      }
      for (let l = band.minLevel; l <= band.maxLevel; l += 1) covered[l] = (covered[l] ?? 0) + 1;
    });
    const gaps = covered.flatMap((c, l) => (c === 0 ? [l] : []));
    const overlaps = covered.flatMap((c, l) => (c > 1 ? [l] : []));
    if (gaps.length > 0 || overlaps.length > 0) {
      out.push(
        at(
          "E_JEV_THRESHOLDS_UNMAPPED",
          `score bands must partition levels 0..${n - 1} exactly once (uncovered: [${gaps.join(", ")}], overlapping: [${overlaps.join(", ")}])`,
          "/question/bands",
        ),
      );
    }
  }

  if (body.fallbackOutcome !== null && !(body.fallbackOutcome in escapes)) {
    out.push(
      at(
        "E_JEV_CONTRACT_INVALID",
        `fallbackOutcome "${body.fallbackOutcome}" must be an escape outcome key (or null ⇒ human)`,
        "/fallbackOutcome",
      ),
    );
  }

  const declaresImproveZone = (["low", "medium", "high"] as const).some((cc) => {
    const t = body.routing.thresholds[cc];
    return t !== undefined && t.improveAt !== null && t.improveAt !== t.autoAt;
  });
  if (declaresImproveZone && !body.routing.improve) {
    out.push(
      at(
        "W_JEV_IMPROVE_UNWIRED",
        "an improve zone is declared but routing.improve names no state-improving action; that zone would route human (§V.B)",
        "/routing/improve",
      ),
    );
  }

  const classes = reachableConsequenceClasses(body);
  for (const cc of classes) {
    if (cc === "irreversible") continue;
    if (body.routing.thresholds[cc] === undefined) {
      out.push(
        at(
          "E_JEV_CONTRACT_INVALID",
          `outcomes of this contract can carry consequence class "${cc}" but routing.thresholds.${cc} is not declared`,
          pointer("routing", "thresholds", cc),
        ),
      );
    }
    if (compareConsequence(cc, body.allowedAction.maxConsequence) > 0) {
      out.push(
        at(
          "E_JEV_CONTRACT_INVALID",
          `allowedAction.maxConsequence (${body.allowedAction.maxConsequence}) is below reachable class "${cc}"`,
          "/allowedAction/maxConsequence",
        ),
      );
    }
  }
  if (
    classes.includes("irreversible") &&
    compareConsequence("irreversible", body.allowedAction.maxConsequence) > 0
  ) {
    out.push(
      at(
        "E_JEV_CONTRACT_INVALID",
        `allowedAction.maxConsequence (${body.allowedAction.maxConsequence}) is below reachable class "irreversible"`,
        "/allowedAction/maxConsequence",
      ),
    );
  }

  if (body.model.primary.provider === "human") {
    out.push(
      at(
        "E_JEV_CONTRACT_INVALID",
        "model.primary must be a decision hop (typesafe, llm, rule or custom); `human` is the escalation path",
        "/model/primary",
      ),
    );
  }
  if (body.version > 1 && body.changelog.trim() === "") {
    out.push(
      at(
        "E_JEV_CONTRACT_INVALID",
        "version > 1 needs a changelog explaining what changes in behaviour and why (§III.D)",
        "/changelog",
      ),
    );
  }

  const goals = Object.entries(body.state.fields).filter(([, f]) => f.role === "goal");
  if (goals.length > 1 || (goals.length === 1 && body.state.goal !== undefined)) {
    out.push(
      at(
        "E_JEV_CONTRACT_INVALID",
        "a packet has one goal: either state.goal or one field with role 'goal'",
        "/state/goal",
      ),
    );
  }

  for (const [name, field] of Object.entries(body.state.fields)) {
    if (dataClassRank(field.dataClass) > dataClassRank(body.state.privacyClass)) {
      out.push(
        at(
          "E_JEV_PACKET_DATA_CLASS",
          `field "${name}" may carry ${field.dataClass} data above the packet's privacyClass ${body.state.privacyClass}`,
          pointer("state", "fields", name, "dataClass"),
        ),
      );
    }
  }

  // TypeSafe budget: the packet budget plus this question must fit 32k (§5.4).
  try {
    const wire =
      q.kind === "choice" && q.menu.source === "dynamic" ? null : toSystemOneQuestion(body);
    const qTokens = wire === null ? 0 : questionTokens(wire);
    if (body.state.maxTokens + qTokens > TYPESAFE_LIMITS.maxStatePlusQuestionTokens) {
      out.push(
        at(
          "E_JEV_PACKET_BUDGET",
          `state.maxTokens (${body.state.maxTokens}) + question (${qTokens}) exceed the ${TYPESAFE_LIMITS.maxStatePlusQuestionTokens}-token state + question limit`,
          "/state/maxTokens",
        ),
      );
    }
  } catch {
    // mapping errors are reported by the schema/menu checks above
  }

  // Declared worst case when every field is bounded by maxChars.
  const fields = Object.values(body.state.fields);
  if (fields.length > 0 && fields.every((f) => f.maxChars !== undefined)) {
    const chars =
      fields.reduce((sum, f) => sum + (f.maxChars ?? 0), 0) + (body.state.goal?.length ?? 0) + 200;
    const worst = Math.ceil(chars / CHARS_PER_TOKEN);
    if (worst > TYPESAFE_LIMITS.maxPacketTokens) {
      out.push(
        at(
          "E_JEV_PACKET_BUDGET",
          `declared worst case is ${worst} tokens, above ${TYPESAFE_LIMITS.maxPacketTokens}; tighten maxChars/selection`,
          "/state/fields",
        ),
      );
    } else if (worst > body.state.maxTokens) {
      out.push(
        at(
          "W_JEV_PACKET_LARGE",
          `declared worst case is ${worst} tokens, above state.maxTokens ${body.state.maxTokens}`,
          "/state/maxTokens",
        ),
      );
    }
  }
  return out;
}

/* ───────────────────────────── contract-level lints (§13.2) ───────────────────────────── */

function lints(body: DecisionContractBody, options: LintContractOptions): JevDiagnostic[] {
  const out: JevDiagnostic[] = [];
  const q = body.question;

  if (isWeakInstruction(q.instructions, body.key)) {
    out.push(
      at(
        "W_JEV_INSTRUCTIONS_WEAK",
        "instructions are too short and vague (or restate the identifier); state the operational definition — identifiers are not instructions (§III.A)",
        "/question/instructions",
      ),
    );
  }
  const exact = exactRuleMatch(q.instructions);
  if (exact !== null) {
    out.push(
      at(
        "W_JEV_EXACT_RULE",
        `instructions contain an exact rule (${exact}); exact comparisons belong in code (branch / FlowExpr) (§X.H)`,
        "/question/instructions",
      ),
    );
  }
  const free = freeValueMatch(q.instructions);
  if (free !== null) {
    out.push(
      at(
        "W_JEV_FREE_VALUE",
        `instructions ask for a free value (${free}) that is not on the menu; extract or generate it, then decide over the known set (§X.I)`,
        "/question/instructions",
      ),
    );
  }

  if (q.kind === "choice") {
    if (isMultiLabelPhrasing(q.instructions)) {
      out.push(
        at(
          "W_JEV_PRIMITIVE_MISMATCH",
          "multi-label phrasing on a Choice: several options may be true at once; split the question (§II.G)",
          "/question/instructions",
        ),
      );
    }
    const entries =
      q.menu.source === "static"
        ? Object.entries(q.menu.outcomes).map(([k, s]) => ({
            key: k,
            description: s.description,
            path: pointer("question", "menu", "outcomes", k, "description"),
          }))
        : Object.entries(q.menu.escapes).map(([k, s]) => ({
            key: k,
            description: s.description,
            path: pointer("question", "menu", "escapes", k, "description"),
          }));
    if (q.menu.source === "static" && Object.keys(escapeOutcomes(body)).length === 0) {
      out.push(
        at(
          "W_JEV_NO_ESCAPE_HATCH",
          "static choice without an escape outcome: when every listed option is wrong, probability mass is forced onto the least-wrong one (§II.A, §X.B); add `none`",
          "/question/menu/outcomes",
        ),
      );
    }
    for (const [i, e] of entries.entries()) {
      if (words(e.description).length < 4) {
        out.push(
          at(
            "W_JEV_OPTIONS_UNDISTINGUISHED",
            `the description of "${e.key}" has fewer than 4 words; state the evidence that distinguishes it (§II.A)`,
            e.path,
          ),
        );
      } else if (isPraiseOnly(e.description)) {
        out.push(
          at(
            "W_JEV_OPTIONS_UNDISTINGUISHED",
            `the description of "${e.key}" praises instead of distinguishing (§VIII.F)`,
            e.path,
          ),
        );
      } else if (describesMultiStepPlan(e.description)) {
        out.push(
          at(
            "W_JEV_OPTIONS_UNDISTINGUISHED",
            `the description of "${e.key}" narrates a multi-step plan; decompose the graph (§X.J)`,
            e.path,
          ),
        );
      }
      for (const other of entries.slice(i + 1)) {
        if (jaccard(e.description, other.description) >= 0.8) {
          out.push(
            at(
              "W_JEV_OPTIONS_UNDISTINGUISHED",
              `"${e.key}" and "${other.key}" have near-duplicate descriptions; where options overlap add a review or none outcome (§VIII.F)`,
              other.path,
            ),
          );
        }
      }
    }
  } else if (q.kind === "score") {
    const n = q.levels.length;
    if (n < 3 || n > 5) {
      out.push(
        at(
          "W_JEV_RUBRIC_LEVELS",
          `score has ${n} levels; prefer three to five well-separated levels (§II.G)`,
          "/question/levels",
        ),
      );
    }
    q.levels.forEach((level, i) => {
      const prev = i > 0 ? q.levels[i - 1] : undefined;
      if (isNumericOnly(level)) {
        out.push(
          at(
            "W_JEV_RUBRIC_ANCHORS",
            `level ${i} is numeric only; levels are verbal descriptions of observable evidence (§II.B)`,
            pointer("question", "levels", i),
          ),
        );
      } else if (words(level).length <= 1 && n > 2 && ordinalLevelShare([level]) === 0) {
        out.push(
          at(
            "W_JEV_RUBRIC_ANCHORS",
            `level ${i} is a single word; describe the observable difference (§II.G)`,
            pointer("question", "levels", i),
          ),
        );
      } else if (
        prev !== undefined &&
        (prev.trim().toLowerCase() === level.trim().toLowerCase() || jaccard(prev, level) >= 0.8)
      ) {
        out.push(
          at(
            "W_JEV_RUBRIC_ANCHORS",
            `level ${i} repeats its neighbour; adjacent levels need a meaningful boundary (§II.G)`,
            pointer("question", "levels", i),
          ),
        );
      }
    });
    if (ordinalLevelShare(q.levels) < 0.5) {
      out.push(
        at(
          "W_JEV_PRIMITIVE_MISMATCH",
          "score levels carry little ordinal vocabulary; unordered categories belong in Choice (§II.G)",
          "/question/levels",
        ),
      );
    }
  } else {
    if (isSeverityPhrasing(q.instructions)) {
      out.push(
        at(
          "W_JEV_PRIMITIVE_MISMATCH",
          "Noul asked as a degree or severity; Noul is yes/no uncertainty — ordered risk belongs in Score (§II.C)",
          "/question/instructions",
        ),
      );
    }
  }

  // State lints.
  for (const [name, field] of Object.entries(body.state.fields)) {
    const path = pointer("state", "fields", name);
    if (
      isChatMessageSchema(field.schema) ||
      (isTranscriptName(name) && field.maxChars === undefined && field.selection === undefined)
    ) {
      out.push(
        at(
          "W_JEV_TRANSCRIPT_STATE",
          `field "${name}" looks like a transcript; bind evidence items or a summary — Jev can only judge the state it receives (§IV.A)`,
          path,
        ),
      );
    }
    if ((field.role === "evidence" || field.role === "fact") && isConclusionName(name)) {
      out.push(
        at(
          "W_JEV_CONCLUSION_AS_EVIDENCE",
          `field "${name}" names a conclusion; store the observations instead (source counts, verified/unresolved claims, freshness) (§X.A)`,
          path,
        ),
      );
    }
    if (field.freshness && (field.role === "evidence" || field.role === "artifact")) {
      const items = field.schema.items;
      if (isSchemaObject(items) && items.properties !== undefined) {
        const need =
          field.role === "evidence"
            ? field.freshness.requireVersion
              ? "version"
              : "observedAt"
            : "hash";
        if (!(need in items.properties)) {
          out.push(
            at(
              "W_JEV_EVIDENCE_UNVERSIONED",
              `field "${name}" declares freshness but its item schema has no \`${need}\` (§IV.D)`,
              pointer("state", "fields", name, "schema"),
            ),
          );
        }
      }
    }
    if (
      (field.role === "evidence" || field.role === "artifact") &&
      !typeIncludes(field.schema, "array") &&
      field.schema.type !== undefined
    ) {
      out.push(
        at(
          "E_JEV_CONTRACT_INVALID",
          `field "${name}" has role ${field.role} but its schema is not an array of items`,
          pointer("state", "fields", name, "schema"),
        ),
      );
    }
  }

  // Eligibility of the primary hop.
  const hop = body.model.primary;
  const hopKey =
    hop.provider === "typesafe"
      ? "typesafe"
      : hop.provider === "llm"
        ? `llm:${hop.model.provider}`
        : hop.provider === "custom"
          ? `custom:${hop.id}`
          : hop.provider;
  const eligible = options.providerEligibility?.[hopKey];
  if (eligible !== undefined) {
    for (const [name, field] of Object.entries(body.state.fields)) {
      if (dataClassRank(field.dataClass) > dataClassRank(eligible) && field.redact === "error") {
        out.push(
          at(
            "E_JEV_PACKET_DATA_CLASS",
            `field "${name}" (${field.dataClass}) would be sent to ${hopKey}, eligible up to ${eligible}, with redact: 'error'`,
            pointer("state", "fields", name, "redact"),
          ),
        );
      }
    }
  }

  // Thresholds.
  const autoCapable = reachableConsequenceClasses(body).some((cc) => {
    if (cc === "irreversible") return false;
    const t = body.routing.thresholds[cc];
    return t === undefined ? cc === "low" : t.autoAt !== null;
  });
  const g = body.routing.governance;
  if (
    autoCapable &&
    (g === undefined || g.approvedBy === null || g.evaluationWindow.source === "illustrative")
  ) {
    out.push(
      at(
        "W_JEV_THRESHOLDS_ILLUSTRATIVE",
        "auto-capable thresholds are illustrative or ungoverned; a threshold from a demo set must not silently become policy (§V.C) — calibrate in shadow and record governance",
        "/routing/governance",
      ),
    );
  }
  if (body.routing.uncalibratedProviders === "allow" && hop.provider !== "typesafe") {
    out.push(
      at(
        "W_JEV_UNCALIBRATED_AUTO",
        "uncalibratedProviders: 'allow' with a non-TypeSafe primary hop lets uncalibrated confidence automate (conflict C3); keep 'human'",
        "/routing/uncalibratedProviders",
      ),
    );
  }
  return out;
}

function suppressedBy(d: JevDiagnostic, body: DecisionContractBody): boolean {
  if (d.severity === "error") return false;
  return body.lintSuppressions.some(
    (s) =>
      s.code === d.code && (s.path === undefined || (d.location.path ?? "").startsWith(s.path)),
  );
}

/** Lints one contract body (§4.2, §13.2). Pure; identical in the browser and on the server. */
export function lintContract(
  input: unknown,
  options: LintContractOptions = {},
): ContractLintResult {
  const parsed = DecisionContractBodySchema.safeParse(input);
  if (!parsed.success) {
    const diagnostics = parsed.error.issues.map((issue) =>
      at(
        "E_JEV_CONTRACT_INVALID",
        `${issue.path.join(".") || "(contract)"}: ${issue.message}`,
        pointer(...issue.path.map((p) => (typeof p === "symbol" ? String(p) : p))),
      ),
    );
    return { body: null, diagnostics, suppressed: [], valid: false };
  }
  const body = parsed.data;
  const all = [...semantic(body), ...lints(body, options)];
  const diagnostics = all.filter((d) => !suppressedBy(d, body));
  const suppressed = all.filter((d) => suppressedBy(d, body));
  return { body, diagnostics, suppressed, valid: !diagnostics.some((d) => d.severity === "error") };
}
