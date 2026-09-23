/**
 * Harness templates (JEV_ENGINEERING.md §9.2–§9.8): every `templates/<name>.json` is a valid
 * `WorkflowDefinition`, every `templates/<name>.contracts.json` holds valid decision contracts,
 * and the two agree — the structural checks the compiler's Jev pass will make (§13.2) that can
 * be decided from the documents alone: contract resolution, interface ports, escalation wiring,
 * shadow isolation, bundle classes, packet field declarations and scope rules for refs.
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  RESERVED_IDS,
  WorkflowDefinitionSchema,
  collectRefs,
  collectTemplateRefs,
  definitionHash,
  parseExpression,
  parseTemplate,
  type Binding,
  type Ref,
  type WorkflowDefinition,
  type WorkflowNode,
} from "@flowaid/workflow-core";
import {
  ContractBindingSchema,
  DecisionContractBodySchema,
  outcomePorts,
  type DecisionContractBody,
} from "../src/contract.js";

const DIR = dirname(fileURLToPath(import.meta.url));
const CONSEQUENCE_ORDER = ["low", "medium", "high", "irreversible"] as const;
const SENTINEL = /^\$template\.(mcp|knowledge)\.[a-z0-9_]+$/;

const ContractsFileSchema = z.strictObject({
  decisionContracts: z
    .array(z.strictObject({ key: z.string(), description: z.string().min(1), body: z.unknown() }))
    .min(1),
});
const TemplateMetaSchema = z.looseObject({
  template: z.looseObject({
    key: z.string(),
    pattern: z.string().min(1),
    contracts: z.array(z.string()).min(1),
    handbook: z.array(z.string()).min(1),
    design: z.string().min(1),
    docs: z.string().min(1),
  }),
});
const JevConfigSchema = z.looseObject({
  contract: ContractBindingSchema.optional(),
  contracts: z.record(z.string(), ContractBindingSchema).optional(),
  routing: z.enum(["inline", "external"]).optional(),
  escalation: z.enum(["wired", "inline"]).optional(),
  legacyPort: z.boolean().optional(),
  question: z.string().optional(),
  keepBands: z.array(z.string()).optional(),
  checks: z
    .array(
      z.strictObject({
        name: z.string(),
        when: z.string(),
        onFail: z.enum(["repair", "collect_evidence", "escalate"]),
      }),
    )
    .optional(),
  production: z
    .strictObject({
      source: z.enum(["llm", "rule", "code", "human", "jev"]),
      answerMap: z.record(z.string(), z.string()).optional(),
    })
    .optional(),
  mode: z.enum(["inline", "deferred"]).optional(),
});
type JevConfig = z.infer<typeof JevConfigSchema>;

/** Config fields of `flowaid.jev.menu` that hold FlowExpr lambdas (§9.1). */
const MENU_LAMBDA_FIELDS = ["keep", "id", "label", "description", "observedAt"] as const;

interface Template {
  name: string;
  raw: unknown;
  definition: WorkflowDefinition;
  contracts: Map<string, DecisionContractBody>;
  rawContracts: Map<string, unknown>;
}

function readJson(file: string): unknown {
  const parsed: unknown = JSON.parse(readFileSync(join(DIR, file), "utf8"));
  return parsed;
}

function loadTemplates(): Template[] {
  const names = readdirSync(DIR)
    .filter((f) => f.endsWith(".json") && !f.endsWith(".contracts.json"))
    .map((f) => f.slice(0, -".json".length))
    .sort();
  return names.map((name) => {
    const raw = readJson(`${name}.json`);
    const file = ContractsFileSchema.parse(readJson(`${name}.contracts.json`));
    const contracts = new Map<string, DecisionContractBody>();
    const rawContracts = new Map<string, unknown>();
    for (const entry of file.decisionContracts) {
      contracts.set(entry.key, DecisionContractBodySchema.parse(entry.body));
      rawContracts.set(entry.key, entry.body);
    }
    return { name, raw, definition: WorkflowDefinitionSchema.parse(raw), contracts, rawContracts };
  });
}

const TEMPLATES = loadTemplates();

/* ───────────────────────────── helpers ───────────────────────────── */

function contractOf(t: Template, key: string): DecisionContractBody {
  const body = t.contracts.get(key);
  if (body === undefined) throw new Error(`${t.name}: contract ${key} is not shipped`);
  return body;
}

function jevConfig(node: WorkflowNode): JevConfig {
  return node.kind === "task" ? JevConfigSchema.parse(node.config) : {};
}

function isJev(node: WorkflowNode): node is Extract<WorkflowNode, { kind: "task" }> {
  return node.kind === "task" && node.type.startsWith("flowaid.jev.");
}

function nodeById(def: WorkflowDefinition, id: string): WorkflowNode {
  const node = def.nodes.find((n) => n.id === id);
  if (node === undefined) throw new Error(`no node ${id}`);
  return node;
}

/** Every binding a node holds, with the scope its refs are evaluated in (container fields: the body). */
function nodeBindings(node: WorkflowNode): { binding: Binding; bodyScope: boolean }[] {
  const out = (b: Binding, bodyScope = false): { binding: Binding; bodyScope: boolean } => ({
    binding: b,
    bodyScope,
  });
  switch (node.kind) {
    case "output":
      return [out(node.value)];
    case "task":
    case "join":
    case "subflow":
      return Object.values(node.inputs).map((b) => out(b));
    case "loop":
      return [...Object.values(node.carry.next), ...Object.values(node.result)].map((b) =>
        out(b, true),
      );
    case "foreach":
      return [out(node.items), ...(node.collect ? [out(node.collect, true)] : [])];
    case "human":
      return [
        out(node.title),
        ...Object.values(node.context).map((b) => out(b)),
        ...(node.mode.type === "review" ? [out(node.mode.value)] : []),
      ];
    case "wait":
      return node.until.type === "timestamp" ? [out(node.until.at)] : [];
    case "input":
    case "branch":
    case "note":
      return [];
  }
}

/** Every FlowExpr source a node holds outside bindings (branch cases, loop exit, verifier checks). */
function nodeExpressions(node: WorkflowNode): { source: string; bodyScope: boolean }[] {
  if (node.kind === "branch") return node.cases.map((c) => ({ source: c.when, bodyScope: false }));
  if (node.kind === "loop" && node.exitWhen !== undefined) {
    return [{ source: node.exitWhen, bodyScope: true }];
  }
  if (node.kind === "task" && node.type === "flowaid.jev.verify") {
    return (jevConfig(node).checks ?? []).map((c) => ({ source: c.when, bodyScope: false }));
  }
  return [];
}

type Source =
  | { kind: "ref"; ref: Ref }
  | { kind: "expr"; source: string }
  | { kind: "template"; source: string };

function* sourcesOf(binding: Binding): Generator<Source> {
  switch (binding.kind) {
    case "literal":
      return;
    case "ref":
      yield { kind: "ref", ref: binding.ref };
      return;
    case "expr":
      yield { kind: "expr", source: binding.source };
      return;
    case "template":
      yield { kind: "template", source: binding.source };
      return;
    case "object":
      for (const b of Object.values(binding.fields)) yield* sourcesOf(b);
      return;
    case "array":
      for (const b of binding.items) yield* sourcesOf(b);
      return;
  }
}

/** Refs of one binding or expression; throws with the parser message on a syntax error. */
function refsOf(source: Source): Ref[] {
  if (source.kind === "ref") return [source.ref];
  if (source.kind === "expr") {
    const parsed = parseExpression(source.source);
    if (!parsed.ok)
      throw new Error(`expression ${JSON.stringify(source.source)}: ${parsed.message}`);
    return collectRefs(parsed.ast);
  }
  const parsed = parseTemplate(source.source);
  if (!parsed.ok) throw new Error(`template ${JSON.stringify(source.source)}: ${parsed.message}`);
  return collectTemplateRefs(parsed.template);
}

/** All refs a node reads, with the scope they are evaluated in. */
function nodeRefs(node: WorkflowNode): { ref: Ref; scope: string }[] {
  const own = node.parent ?? "";
  const bodyScope = node.kind === "loop" || node.kind === "foreach" ? node.id : own;
  const out: { ref: Ref; scope: string }[] = [];
  for (const { binding, bodyScope: body } of nodeBindings(node)) {
    for (const source of sourcesOf(binding)) {
      for (const ref of refsOf(source)) out.push({ ref, scope: body ? bodyScope : own });
    }
  }
  for (const { source, bodyScope: body } of nodeExpressions(node)) {
    for (const ref of refsOf({ kind: "expr", source }))
      out.push({ ref, scope: body ? bodyScope : own });
  }
  return out;
}

/** Scope ids from `scope` outward to the root (`""`). */
function scopeChain(def: WorkflowDefinition, scope: string): string[] {
  const chain: string[] = [];
  let current: string | undefined = scope;
  while (current !== undefined) {
    chain.push(current);
    if (current === "") break;
    const container = def.nodes.find((n) => n.id === current);
    current = container?.parent ?? "";
  }
  return chain;
}

/** Control-out ports a node may fire (ARCHITECTURE §2.4; JEV_ENGINEERING §4.5, §9.1). */
function controlPorts(t: Template, node: WorkflowNode): string[] {
  switch (node.kind) {
    case "input":
      return ["done"];
    case "output":
    case "note":
      return [];
    case "branch":
      return [...node.cases.map((c) => c.port), node.defaultPort];
    case "loop":
      return ["done", "exhausted"];
    case "human": {
      const expired = node.onExpire === "route" ? ["expired"] : [];
      switch (node.mode.type) {
        case "approval":
        case "review":
          return ["approved", "rejected", ...expired];
        case "form":
          return ["submitted", ...expired];
        case "choice":
          return [...node.mode.options.map((o) => o.id), ...expired];
      }
      return [];
    }
    case "task": {
      const failed = node.policy?.onError === "route" ? ["failed"] : [];
      if (!isJev(node)) return ["done", ...failed];
      const cfg = jevConfig(node);
      const body = cfg.contract ? contractOf(t, cfg.contract.key) : undefined;
      switch (node.type) {
        case "flowaid.jev.decide":
        case "flowaid.jev.route": {
          if (body === undefined) throw new Error(`${node.id}: no contract`);
          const ports = outcomePorts(body, {
            routing: node.type === "flowaid.jev.route" ? "inline" : (cfg.routing ?? "inline"),
            legacyPort: cfg.legacyPort === true,
          });
          return cfg.escalation === "inline" ? ports.filter((p) => p !== "human") : ports;
        }
        case "flowaid.jev.bundle":
        case "flowaid.jev.shadow":
        case "flowaid.jev.packet":
          return node.type === "flowaid.jev.packet" ? ["done", "over_budget"] : ["done"];
        case "flowaid.jev.menu":
          return ["done", "empty"];
        case "flowaid.jev.tool_gate":
          return ["allow", "review", "deny"];
        case "flowaid.jev.relevance":
          return ["done", "insufficient"];
        case "flowaid.jev.verify": {
          const outcomes =
            body?.question.kind === "choice" && body.question.menu.source === "static"
              ? Object.keys(body.question.menu.outcomes)
              : [];
          return [
            "pass",
            "repair",
            ...(outcomes.includes("collect_evidence") ? ["collect_evidence"] : []),
            "human",
          ];
        }
        default:
          throw new Error(`${node.id}: unknown Jev node type ${node.type}`);
      }
    }
    case "foreach":
    case "subflow":
    case "join":
    case "wait":
      return ["done"];
  }
}

function edgesFrom(def: WorkflowDefinition, nodeId: string): { port: string; to: string }[] {
  return def.edges
    .filter((e) => e.from.node === nodeId)
    .map((e) => ({ port: e.from.port, to: e.to.node }));
}

/** Keys of an `object` binding (the `state` / `context` input of contract nodes). */
function objectKeys(binding: Binding | undefined): string[] {
  if (binding === undefined) return [];
  if (binding.kind !== "object") throw new Error("expected an object binding");
  return Object.keys(binding.fields);
}

function fieldNames(body: DecisionContractBody): { all: string[]; required: string[] } {
  const entries = Object.entries(body.state.fields);
  return {
    all: entries.map(([k]) => k),
    required: entries.filter(([, f]) => f.required).map(([k]) => k),
  };
}

function staticOutcomes(
  body: DecisionContractBody,
): Record<string, { escape?: string | undefined }> {
  if (body.question.kind !== "choice" || body.question.menu.source !== "static") return {};
  return body.question.menu.outcomes;
}

function rank(cc: (typeof CONSEQUENCE_ORDER)[number]): number {
  return CONSEQUENCE_ORDER.indexOf(cc);
}

function stringsIn(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) for (const v of value) stringsIn(v, out);
  else if (typeof value === "object" && value !== null)
    for (const v of Object.values(value)) stringsIn(v, out);
  return out;
}

/* ───────────────────────────── tests ───────────────────────────── */

describe("harness template set", () => {
  it("ships the handbook's harness patterns, each with a contracts file", () => {
    expect(TEMPLATES.map((t) => t.name)).toEqual([
      "jev-classifier-rollout",
      "jev-escalation-triage",
      "jev-first-contract-shadow",
      "jev-retrieval-relevance",
      "jev-tool-gate",
      "jev-verified-builder",
    ]);
    const files = readdirSync(DIR)
      .filter((f) => f.endsWith(".json"))
      .sort();
    expect(files).toEqual(
      TEMPLATES.flatMap((t) => [`${t.name}.contracts.json`, `${t.name}.json`]).sort(),
    );
  });

  it("gives every template a distinct id and definition hash", () => {
    const ids = TEMPLATES.map((t) => t.definition.id);
    const hashes = TEMPLATES.map((t) => definitionHash(t.raw));
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(hashes).size).toBe(hashes.length);
  });

  it("ships one body per contract key across templates (a key shared by templates has one interface)", () => {
    const seen = new Map<string, { template: string; body: unknown }>();
    for (const t of TEMPLATES) {
      for (const [key, body] of t.rawContracts) {
        const earlier = seen.get(key);
        if (earlier === undefined) seen.set(key, { template: t.name, body });
        else expect(body, `${key} in ${t.name} vs ${earlier.template}`).toEqual(earlier.body);
      }
    }
  });
});

for (const t of TEMPLATES) {
  const def = t.definition;

  describe(`${t.name}: workflow definition`, () => {
    it("parses as a WorkflowDefinition and hashes identically raw and parsed", () => {
      expect(definitionHash(t.raw)).toMatch(/^[0-9a-f]{64}$/);
      expect(definitionHash(def)).toBe(definitionHash(t.raw));
    });

    it("declares its template metadata: key, pattern, handbook sections, contracts, docs", () => {
      const meta = TemplateMetaSchema.parse(def.metadata).template;
      expect(meta.key).toBe(t.name);
      expect([...meta.contracts].sort()).toEqual([...t.contracts.keys()].sort());
      for (const section of meta.handbook)
        expect(section).toMatch(/^(§[IVX]+(\.[A-O])?|Table [IVX]+)/);
      expect(meta.docs).toMatch(/^docs\/jev\/[a-z-]+\.md$/);
      expect(readFileSync(join(DIR, "..", "..", "..", meta.docs), "utf8").length).toBeGreaterThan(
        0,
      );
    });

    it("has unique, unreserved node ids, one input, at least one output, and containers as parents", () => {
      const ids = def.nodes.map((n) => n.id);
      expect(new Set(ids).size).toBe(ids.length);
      for (const id of ids) expect(RESERVED_IDS.has(id), id).toBe(false);
      expect(def.nodes.filter((n) => n.kind === "input" && n.parent === undefined)).toHaveLength(1);
      expect(def.nodes.filter((n) => n.kind === "output").length).toBeGreaterThan(0);
      for (const node of def.nodes) {
        if (node.parent === undefined) continue;
        expect(["loop", "foreach"], `${node.id}.parent`).toContain(nodeById(def, node.parent).kind);
      }
    });

    it("has control edges between existing nodes of one scope, on ports the source node fires", () => {
      const edgeIds = def.edges.map((e) => e.id);
      expect(new Set(edgeIds).size).toBe(edgeIds.length);
      for (const e of def.edges) {
        const from = nodeById(def, e.from.node);
        const to = nodeById(def, e.to.node);
        expect(from.id, `${e.id} self edge`).not.toBe(to.id);
        expect(from.parent ?? "", `${e.id} crosses a container boundary`).toBe(to.parent ?? "");
        expect(controlPorts(t, from), `${e.id}: ${e.from.node}.${e.from.port}`).toContain(
          e.from.port,
        );
      }
    });

    it("parses every expression and template, and resolves every ref within scope", () => {
      const variables = new Set(def.variables.map((v) => v.name));
      for (const node of def.nodes) {
        for (const { ref, scope } of nodeRefs(node)) {
          const where = `${node.id} → ${JSON.stringify(ref)}`;
          switch (ref.kind) {
            case "port": {
              expect(ref.node, where).not.toBe(node.id);
              const producer = nodeById(def, ref.node);
              expect(scopeChain(def, scope), where).toContain(producer.parent ?? "");
              break;
            }
            case "var":
              expect(variables.has(ref.name), where).toBe(true);
              break;
            case "scope":
              expect(scope, where).not.toBe("");
              break;
            case "run":
              break;
          }
        }
      }
    });

    it("parses the templated config strings and the menu lambdas", () => {
      for (const node of def.nodes) {
        if (node.kind !== "task") continue;
        const url = node.config["url"];
        if (typeof url === "string")
          expect(parseTemplate(url).ok, `${node.id}.config.url`).toBe(true);
        if (node.type !== "flowaid.jev.menu") continue;
        const lambdas: unknown[] = MENU_LAMBDA_FIELDS.map((f) => node.config[f]);
        const cost = node.config["cost"];
        if (typeof cost === "object" && cost !== null && !Array.isArray(cost))
          lambdas.push(cost["by"]);
        for (const lambda of lambdas) {
          if (lambda === undefined) continue;
          expect(typeof lambda, node.id).toBe("string");
          const parsed = parseExpression(`map([], ${String(lambda)})`);
          expect(parsed.ok, `${node.id}: ${String(lambda)}`).toBe(true);
        }
      }
    });

    it("declares every secret and variable it uses, and only well-formed resource sentinels", () => {
      const secrets = new Set(def.secrets.map((s) => s.name));
      for (const node of def.nodes) {
        if (node.kind !== "task") continue;
        for (const secret of Object.values(node.credentials))
          expect(secrets.has(secret), `${node.id}: ${secret}`).toBe(true);
      }
      const used = new Set(
        stringsIn(def.nodes).flatMap((s) =>
          [...s.matchAll(/\$vars\.([a-zA-Z0-9_]+)/g)].map((m) => m[1]),
        ),
      );
      for (const name of used)
        expect(
          def.variables.map((v) => v.name),
          `$vars.${String(name)}`,
        ).toContain(name);
      for (const s of stringsIn(def.nodes))
        if (s.startsWith("$template.")) expect(s).toMatch(SENTINEL);
    });
  });

  describe(`${t.name}: decision contracts`, () => {
    for (const [key, body] of t.contracts) {
      it(`${key}@${body.version}: is a valid, reviewable contract (JEV_ENGINEERING §4.2)`, () => {
        expect(body.key).toBe(key);
        expect(body.version).toBe(1);
        const q = body.question;
        if (q.kind === "choice" && q.menu.source === "static") {
          const outcomes = Object.values(q.menu.outcomes);
          expect(outcomes.length).toBeGreaterThanOrEqual(2);
          expect(outcomes.length).toBeLessThanOrEqual(255);
          expect(
            outcomes.some((o) => o.escape !== undefined),
            "W_JEV_NO_ESCAPE_HATCH",
          ).toBe(true);
          const descriptions = outcomes.map((o) => o.description);
          expect(new Set(descriptions).size, "W_JEV_OPTIONS_UNDISTINGUISHED").toBe(
            descriptions.length,
          );
          for (const d of descriptions) expect(d.split(/\s+/).length).toBeGreaterThanOrEqual(4);
        }
        if (q.kind === "choice" && q.menu.source === "dynamic") {
          const escapes = Object.entries(q.menu.escapes);
          expect(escapes.length, "E_JEV_DYNAMIC_MENU_NO_ESCAPE").toBeGreaterThanOrEqual(1);
          expect(q.menu.maxOptions + escapes.length).toBeLessThanOrEqual(255);
          for (const [k, spec] of escapes) if (spec.escape === "stop") expect(k).toBe("stop");
        }
        if (q.kind === "score") {
          expect(q.levels.length, "W_JEV_RUBRIC_LEVELS").toBeGreaterThanOrEqual(3);
          expect(q.levels.length, "W_JEV_RUBRIC_LEVELS").toBeLessThanOrEqual(5);
          const covered = (q.bands ?? []).flatMap((b) =>
            Array.from({ length: b.maxLevel - b.minLevel + 1 }, (_, i) => b.minLevel + i),
          );
          if (q.bands)
            expect(covered, "bands partition the levels").toEqual(q.levels.map((_, i) => i));
        }
        expect(
          q.instructions.split(/\s+/).length,
          "W_JEV_INSTRUCTIONS_WEAK",
        ).toBeGreaterThanOrEqual(8);

        const escapeKeys = Object.entries(staticOutcomes(body))
          .filter(([, o]) => o.escape !== undefined)
          .map(([k]) => k);
        if (q.kind === "choice" && q.menu.source === "dynamic")
          escapeKeys.push(...Object.keys(q.menu.escapes));
        if (body.fallbackOutcome !== null) expect(escapeKeys).toContain(body.fallbackOutcome);

        const classes = new Set([body.routing.consequenceClass]);
        if (q.kind === "choice" && q.menu.source === "static") {
          for (const o of Object.values(q.menu.outcomes))
            if (o.consequenceClass) classes.add(o.consequenceClass);
        }
        if (q.kind === "score")
          for (const b of q.bands ?? []) if (b.consequenceClass) classes.add(b.consequenceClass);
        for (const cc of classes) {
          if (cc !== "irreversible")
            expect(body.routing.thresholds[cc], `thresholds for ${cc}`).toBeDefined();
          expect(
            rank(body.allowedAction.maxConsequence),
            `maxConsequence ≥ ${cc}`,
          ).toBeGreaterThanOrEqual(rank(cc));
        }
        for (const zone of Object.values(body.routing.thresholds)) {
          if (zone.improveAt !== null && zone.improveAt !== undefined) {
            expect(body.routing.improve, "W_JEV_IMPROVE_UNWIRED").toBeDefined();
          }
        }
        expect(
          body.routing.governance,
          "templates ship illustrative thresholds, never fake governance",
        ).toBeUndefined();
        const goalFields = Object.values(body.state.fields).filter((f) => f.role === "goal").length;
        expect(goalFields + (body.state.goal === undefined ? 0 : 1)).toBeLessThanOrEqual(1);
        expect(body.model.primary.provider).toBe("typesafe");
        expect(body.escalation.rubric.length, "written labeling rubric").toBeGreaterThan(0);
      });
    }

    it("uses every shipped contract, and binds every contract node to a shipped key", () => {
      const used = new Set<string>();
      for (const node of def.nodes.filter(isJev)) {
        const cfg = jevConfig(node);
        const keys = [
          ...(cfg.contract ? [cfg.contract.key] : []),
          ...Object.values(cfg.contracts ?? {}).map((b) => b.key),
        ];
        expect(keys.length, `${node.id} binds a contract`).toBeGreaterThan(0);
        for (const key of keys) {
          expect(t.contracts.has(key), `${node.id}: ${key}`).toBe(true);
          used.add(key);
        }
      }
      expect([...used].sort()).toEqual([...t.contracts.keys()].sort());
    });
  });

  describe(`${t.name}: Jev harness rules`, () => {
    it("wires escalation for every contract node that can route to a person (E_JEV_ESCALATION_UNWIRED)", () => {
      for (const node of def.nodes.filter(isJev)) {
        const ports = controlPorts(t, node);
        const wired = new Set(edgesFrom(def, node.id).map((e) => e.port));
        if (ports.includes("human") && node.type !== "flowaid.jev.verify") {
          expect(wired.has("human"), `${node.id}.human`).toBe(true);
        }
        if (node.type === "flowaid.jev.tool_gate") {
          expect(wired.has("review"), `${node.id}.review`).toBe(true);
          expect(wired.has("deny"), `${node.id}.deny`).toBe(true);
        }
      }
    });

    it("binds exactly the declared state fields of each contract (least privilege, §5.2)", () => {
      for (const node of def.nodes.filter(isJev)) {
        const cfg = jevConfig(node);
        if (node.type === "flowaid.jev.decide" || node.type === "flowaid.jev.shadow") {
          const body = contractOf(t, cfg.contract?.key ?? "");
          const bound = objectKeys(node.inputs["state"]);
          const { all, required } = fieldNames(body);
          for (const k of bound)
            expect(all, `${node.id}.state.${k} (W_JEV_PACKET_UNDECLARED_FIELD)`).toContain(k);
          for (const k of required) expect(bound, `${node.id}.state.${k} required`).toContain(k);
        }
        if (node.type === "flowaid.jev.bundle") {
          const bodies = Object.values(cfg.contracts ?? {}).map((b) => contractOf(t, b.key));
          const bound = objectKeys(node.inputs["state"]);
          const declared = new Set(bodies.flatMap((b) => fieldNames(b).all));
          for (const k of bound) expect(declared.has(k), `${node.id}.state.${k}`).toBe(true);
          for (const b of bodies)
            for (const k of fieldNames(b).required) expect(bound, `${b.key}: ${k}`).toContain(k);
          expect(
            new Set(bodies.map((b) => b.state.privacyClass)).size,
            "E_JEV_BUNDLE_CLASS_MIX",
          ).toBe(1);
          expect(
            new Set(bodies.map((b) => b.state.latencyClass)).size,
            "E_JEV_BUNDLE_CLASS_MIX",
          ).toBe(1);
        }
        if (node.type === "flowaid.jev.verify" || node.type === "flowaid.jev.relevance") {
          const body = contractOf(t, cfg.contract?.key ?? "");
          const { all, required } = fieldNames(body);
          const bound = Object.keys(node.inputs);
          for (const k of required) expect(bound, `${node.id}.${k}`).toContain(k);
          for (const k of bound) expect(all, `${node.id}.${k}`).toContain(k);
        }
        if (node.type === "flowaid.jev.tool_gate") {
          const body = contractOf(t, cfg.contract?.key ?? "");
          for (const k of objectKeys(node.inputs["context"]))
            expect(fieldNames(body).all, `${node.id}.context.${k}`).toContain(k);
        }
      }
    });

    it("pairs specialised nodes with contracts of the right interface (§9.1)", () => {
      for (const node of def.nodes.filter(isJev)) {
        const cfg = jevConfig(node);
        const body = cfg.contract ? contractOf(t, cfg.contract.key) : undefined;
        const q = body?.question;
        switch (node.type) {
          case "flowaid.jev.verify":
            expect(Object.keys(staticOutcomes(body ?? contractOf(t, "")))).toEqual(
              expect.arrayContaining(["pass", "repair"]),
            );
            break;
          case "flowaid.jev.relevance": {
            const bands = q?.kind === "score" ? (q.bands ?? []).map((b) => b.port) : [];
            expect(bands.length, `${node.id} needs a banded score`).toBeGreaterThan(0);
            for (const band of cfg.keepBands ?? []) expect(bands).toContain(band);
            break;
          }
          case "flowaid.jev.menu":
            expect(
              q?.kind === "choice" && q.menu.source === "dynamic",
              `${node.id}: dynamic menu`,
            ).toBe(true);
            break;
          case "flowaid.jev.decide": {
            const options = node.inputs["options"];
            const dynamic = q?.kind === "choice" && q.menu.source === "dynamic";
            expect(options !== undefined, `${node.id}: options input iff dynamic menu`).toBe(
              dynamic,
            );
            if (options?.kind === "ref" && options.ref.kind === "port") {
              const menu = nodeById(def, options.ref.node);
              expect(menu.kind === "task" && menu.type, node.id).toBe("flowaid.jev.menu");
              expect(jevConfig(menu).contract?.key).toBe(cfg.contract?.key);
            }
            break;
          }
          case "flowaid.jev.route": {
            const decision = node.inputs["decision"];
            if (decision?.kind === "ref" && decision.ref.kind === "port") {
              const source = nodeById(def, decision.ref.node);
              const sourceCfg = jevConfig(source);
              const question = cfg.question ?? "";
              expect(decision.ref.path, node.id).toBe(`/${question}`);
              expect(
                sourceCfg.contracts?.[question]?.key,
                `${node.id} routes the same contract`,
              ).toBe(cfg.contract?.key);
            }
            break;
          }
          case "flowaid.jev.shadow": {
            const outcomes = Object.keys(staticOutcomes(body ?? contractOf(t, "")));
            for (const mapped of Object.values(cfg.production?.answerMap ?? {}))
              expect(outcomes).toContain(mapped);
            break;
          }
          default:
            break;
        }
      }
    });

    it("keeps shadow evaluation isolated: no control edges, outputs feed nothing that acts (E_JEV_SHADOW_LEAK)", () => {
      for (const shadow of def.nodes.filter((n) => isJev(n) && n.type === "flowaid.jev.shadow")) {
        expect(edgesFrom(def, shadow.id)).toEqual([]);
        expect(shadow.kind === "task" && shadow.policy?.onError).toBe("ignore");
        expect(shadow.kind === "task" && shadow.policy?.timeoutMs).toBeLessThanOrEqual(5000);
        for (const node of def.nodes) {
          const reads = nodeRefs(node).some(
            ({ ref }) => ref.kind === "port" && ref.node === shadow.id,
          );
          if (reads) expect(node.kind, `${node.id} reads ${shadow.id}`).toBe("output");
        }
      }
    });

    it("keeps its rollout plan inside the contract's outcomes (§IX.F, §IX.I)", () => {
      const stages = z
        .array(
          z.looseObject({
            stage: z.string(),
            guardrails: z.looseObject({ outcomes: z.array(z.string()) }).optional(),
          }),
        )
        .optional()
        .parse(TemplateMetaSchema.parse(def.metadata).template["rolloutStages"]);
      for (const stage of stages ?? []) {
        for (const key of t.contracts.keys()) {
          const outcomes = Object.entries(staticOutcomes(contractOf(t, key)))
            .filter(([, o]) => o.escape === undefined)
            .map(([k]) => k);
          for (const o of stage.guardrails?.outcomes ?? [])
            expect(outcomes, stage.stage).toContain(o);
        }
      }
    });
  });
}
