/**
 * Plain-language explanations for the Guide (pure, so it is unit tested): what a workflow does,
 * what one step does, what a rule means, and what happened in a run. Everything is derived from
 * the definition and the run's own records; nothing is guessed, and nothing needs an AI model.
 */
import {
  parseExpression,
  parseTemplate,
  type Binding,
  type ExprAst,
  type NodeManifest,
  type Ref,
  type WorkflowDefinition,
  type WorkflowNode,
} from "@flowaid/workflow-core";
import type { NodeRunView, RunView } from "@flowaid/ui";

// ── words ──────────────────────────────────────────────────────────────────────────────────────

/** "autoRefundLimit" → "auto refund limit"; "needs_person" → "needs person". */
export function words(name: string): string {
  return name
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .trim();
}

const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const quote = (s: string) => `“${s}”`;
const list = (items: string[]) =>
  items.length <= 1
    ? (items[0] ?? "")
    : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
const pct = (p: number) => `${Math.round(p * 100)}%`;

function duration(ms: number): string {
  const h = ms / 3_600_000;
  if (h >= 24 && Number.isInteger(h / 24)) return `${h / 24} day${h === 24 ? "" : "s"}`;
  if (h >= 1) return `${Math.round(h)} hour${Math.round(h) === 1 ? "" : "s"}`;
  const m = Math.round(ms / 60_000);
  return `${m} minute${m === 1 ? "" : "s"}`;
}

/** How long someone took: "17 seconds", "4 minutes", "2 hours". */
function waited(ms: number): string {
  const secs = Math.max(1, Math.round(ms / 1000));
  if (secs < 60) return `${secs} second${secs === 1 ? "" : "s"}`;
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"}`;
  return duration(ms);
}

type Node = WorkflowDefinition["nodes"][number];
const byId = (def: WorkflowDefinition, id: string) => def.nodes.find((n) => n.id === id);
const nameOf = (def: WorkflowDefinition, id: string) => byId(def, id)?.name ?? words(id);

function inputTitle(def: WorkflowDefinition, key: string): string {
  const props = (def.inputs as { properties?: Record<string, { title?: string }> }).properties;
  return props?.[key]?.title ?? cap(words(key));
}

function batchQuestion(def: WorkflowDefinition, nodeId: string, key: string) {
  const n = byId(def, nodeId);
  const qs =
    n?.kind === "task"
      ? (n.config as { questions?: Record<string, Question> }).questions
      : undefined;
  return qs?.[key];
}

interface Question {
  kind: "choice" | "boolean" | "score";
  instructions: string;
  options?: Record<string, string>;
  criteria?: { true: string; false: string };
  levels?: string[];
}

// ── rules ──────────────────────────────────────────────────────────────────────────────────────

/** A reference in words: "the Order total", "the auto refund limit setting", "the answer to …". */
export function describeRef(ref: Ref, def: WorkflowDefinition): string {
  switch (ref.kind) {
    case "var": {
      const v = def.variables.find((x) => x.name === ref.name);
      const value = v?.default !== undefined ? ` (now ${JSON.stringify(v.default)})` : "";
      return `the ${words(ref.name)} setting${value}`;
    }
    case "run":
      return `the run's ${words(ref.field)}`;
    case "scope":
      return `the current ${words(ref.field)}`;
    case "port": {
      const node = byId(def, ref.node);
      const segs = (ref.path ?? "").split("/").filter(Boolean);
      if (node?.kind === "input") return `the ${inputTitle(def, ref.port)}`;
      // the question itself is on the decision step; here its short name reads better
      if (ref.port === "answers" && segs[0]) return `the ${words(segs[0])} answer`;
      if (ref.port === "decision") return `${quote(nameOf(def, ref.node))}'s answer`;
      return segs.length
        ? `the ${segs.map(words).join(" ")} from ${quote(nameOf(def, ref.node))}`
        : `the ${words(ref.port)} of ${quote(nameOf(def, ref.node))}`;
    }
  }
}

const OPS: Record<string, string> = {
  "==": "is",
  "!=": "is not",
  "<": "is less than",
  "<=": "is at most",
  ">": "is more than",
  ">=": "is at least",
  in: "is one of",
  matches: "matches",
  "+": "plus",
  "-": "minus",
  "*": "times",
  "/": "divided by",
  "%": "modulo",
};

/** A yes/no value on its own reads as a statement: "the eligible answer is yes". */
function statement(ast: ExprAst, def: WorkflowDefinition): string {
  if (ast.kind === "ref") return `${describeRef(ast.ref, def)} is yes`;
  if (ast.kind === "unary" && ast.op === "!" && ast.operand.kind === "ref")
    return `${describeRef(ast.operand.ref, def)} is no`;
  if (ast.kind === "binary" && ast.op === "||") return `either ${describeAst(ast, def)}`;
  return describeAst(ast, def);
}

/**
 * An expression's syntax tree in words. `nested` is set inside a larger calculation, where an
 * if/otherwise reads as "(10 if …, else 0)" so the sentence around it still makes sense.
 */
export function describeAst(ast: ExprAst, def: WorkflowDefinition, nested = false): string {
  const d = (a: ExprAst) => describeAst(a, def, true);
  switch (ast.kind) {
    case "literal":
      return ast.value === true
        ? "yes"
        : ast.value === false
          ? "no"
          : typeof ast.value === "string"
            ? quote(words(ast.value))
            : String(ast.value);
    case "ref":
      return describeRef(ast.ref, def);
    case "ident":
      return ast.name;
    case "unary":
      return ast.op === "!" ? `not (${statement(ast.operand, def)})` : `minus ${d(ast.operand)}`;
    case "binary":
      if (ast.op === "&&") return `${statement(ast.left, def)} and ${statement(ast.right, def)}`;
      if (ast.op === "||")
        return `${statement(ast.left, def).replace(/^either /, "")} or ${statement(ast.right, def)}`;
      return `${d(ast.left)} ${OPS[ast.op] ?? ast.op} ${d(ast.right)}`;
    case "ternary":
      return nested
        ? `(${d(ast.then)} if ${statement(ast.test, def)}, else ${d(ast.else)})`
        : `if ${statement(ast.test, def)}, ${d(ast.then)}; otherwise ${describeAst(ast.else, def)}`;
    case "member":
      return `${words(ast.key)} of ${d(ast.object)}`;
    case "index":
      return `${d(ast.object)} [${d(ast.index)}]`;
    case "call":
      if (ast.fn === "round" && ast.args.length === 1)
        return `${describeAst(ast.args[0] as ExprAst, def)}, rounded`;
      if ((ast.fn === "min" || ast.fn === "max") && ast.args.length === 2)
        return `the ${ast.fn === "min" ? "smaller" : "larger"} of ${d(ast.args[0] as ExprAst)} and ${d(ast.args[1] as ExprAst)}`;
      return `${words(ast.fn)} of ${list(ast.args.map(d))}`;
    case "lambda":
      return d(ast.body);
    case "array":
      return list(ast.items.map(d));
    case "object":
      return ast.entries.map((e) => `${words(e.key)}: ${describeAst(e.value, def)}`).join("; ");
  }
}

/** A rule (FlowExpr source) in words, or the source itself when it does not parse. */
export function describeRule(source: string, def: WorkflowDefinition): string {
  const parsed = parseExpression(source);
  return parsed.ok ? statement(parsed.ast, def) : source;
}

/**
 * A calculation in words, one line per result it works out (an object gives one line per field),
 * or the source itself when it does not parse.
 */
export function describeCalculation(source: string, def: WorkflowDefinition): string[] {
  const parsed = parseExpression(source);
  if (!parsed.ok) return [source];
  const ast = parsed.ast;
  return ast.kind === "object"
    ? ast.entries.map((e) => `${cap(words(e.key))}: ${statement(e.value, def)}`)
    : [cap(describeAst(ast, def))];
}

/** A template ("Hi {{ start.name }}") with each value in words: "Hi [the Name]". */
export function describeTemplate(source: string, def: WorkflowDefinition): string {
  const parsed = parseTemplate(source);
  if (!parsed.ok) return source;
  return parsed.template.parts
    .map((p) => (p.kind === "text" ? p.text : `[${describeAst(p.expr, def)}]`))
    .join("");
}

function describeBinding(b: Binding | undefined, def: WorkflowDefinition): string {
  if (!b) return "nothing";
  switch (b.kind) {
    case "literal":
      return typeof b.value === "string" ? quote(b.value) : JSON.stringify(b.value);
    case "ref":
      return describeRef(b.ref, def);
    case "template":
      return quote(describeTemplate(b.source, def));
    case "expr":
      return describeRule(b.source, def);
    case "object":
      return Object.entries(b.fields)
        .map(([k, v]) => `${words(k)}: ${describeBinding(v, def)}`)
        .join("; ");
    case "array":
      return list(b.items.map((x) => describeBinding(x, def)));
  }
}

// ── steps ──────────────────────────────────────────────────────────────────────────────────────

/** Where a control port of a node leads, by the names of the steps it reaches. */
function targets(def: WorkflowDefinition, nodeId: string, port: string): string[] {
  return def.edges
    .filter((e) => e.from.node === nodeId && e.from.port === port)
    .map((e) => quote(nameOf(def, e.to.node)));
}

export interface StepExplanation {
  /** One line: what the step is for. */
  summary: string;
  /** Details, one per line. */
  details: string[];
  /** How a person changes it, in the builder. */
  change?: string;
}

function questionLines(q: Question, key: string): string {
  const head = `${cap(words(key))}: ${q.instructions}`;
  if (q.kind === "choice" && q.options)
    return `${head} One of: ${list(Object.keys(q.options).map((o) => quote(words(o))))}.`;
  if (q.kind === "boolean" && q.criteria)
    return `${head} Yes means ${quote(q.criteria.true)}; no means ${quote(q.criteria.false)}.`;
  if (q.kind === "score" && q.levels)
    return `${head} On a scale from ${quote(q.levels[0] ?? "")} to ${quote(q.levels.at(-1) ?? "")}.`;
  return head;
}

export function explainStep(
  node: WorkflowNode,
  def: WorkflowDefinition,
  manifest?: Pick<NodeManifest, "metadata">,
): StepExplanation {
  switch (node.kind) {
    case "input": {
      const schema = def.inputs as {
        properties?: Record<string, { title?: string; description?: string }>;
        required?: string[];
      };
      const props = Object.entries(schema.properties ?? {});
      return {
        summary: "Where every run starts: the information the workflow asks for.",
        details: props.map(([k, p]) => {
          const req = schema.required?.includes(k) ? "required" : "optional";
          return `${p.title ?? cap(words(k))} (${req})${p.description ? `: ${p.description}` : ""}`;
        }),
        change: "To change it: add, remove or describe the fields in this step's settings.",
      };
    }
    case "output": {
      const fields = node.value.kind === "object" ? Object.entries(node.value.fields) : [];
      return {
        summary: `An end of the workflow${node.outcome ? `, with the outcome ${quote(words(node.outcome))}` : ""}. The run finishes here and returns its result.`,
        details: fields.map(([k, b]) => `${cap(words(k))}: ${describeBinding(b, def)}`),
        change:
          "To change it: edit what the run returns, such as the reply to a customer, in this step's settings.",
      };
    }
    case "branch": {
      const details = node.cases.map(
        (c) =>
          `If ${describeRule(c.when, def)}, it goes to ${list(targets(def, node.id, c.port)) || "nothing yet"}.`,
      );
      details.push(
        `Otherwise it goes to ${list(targets(def, node.id, node.defaultPort)) || "nothing yet"}.`,
      );
      return {
        summary: "Chooses where the run goes next, using plain rules checked in order.",
        details,
        change:
          "To change it: edit a rule in this step's settings, or drag a line to change where a path leads.",
      };
    }
    case "human": {
      const mode = node.mode.type;
      const details = [
        `A person sees: ${node.title.kind === "template" ? quote(describeTemplate(node.title.source, def)) : describeBinding(node.title, def)}.`,
        node.assignees.length
          ? `Who can answer: ${list(node.assignees.map((a) => words(a.replace(/^role:/, ""))))}.`
          : "Anyone allowed to approve runs can answer.",
      ];
      if (mode === "approval" || mode === "review") {
        const ok = targets(def, node.id, "approved");
        const no = targets(def, node.id, "rejected");
        if (ok.length) details.push(`If approved, it goes to ${list(ok)}.`);
        if (no.length) details.push(`If rejected, it goes to ${list(no)}.`);
      }
      if (node.expiresInMs) {
        const late = targets(def, node.id, "expired");
        details.push(
          `If nobody answers within ${duration(node.expiresInMs)}, ${late.length ? `it goes to ${list(late)}` : "the task expires"}.`,
        );
      }
      return {
        summary: `Pauses the run until a person ${mode === "approval" ? "approves or rejects it" : mode === "form" ? "fills in a form" : mode === "choice" ? "picks an option" : "reviews it"}. The request waits under Human tasks.`,
        details,
        change:
          "To change it: edit what the person sees, who answers, or how long it waits, in this step's settings.",
      };
    }
    case "task": {
      const config = node.config as Record<string, unknown>;
      if (node.type === "flowaid.decision.batch") {
        const qs = Object.entries((config.questions ?? {}) as Record<string, Question>);
        return {
          summary: `Asks TypeSafe ${qs.length} question${qs.length === 1 ? "" : "s"} in one call. Each answer comes with how sure it is.`,
          details: qs.map(([k, q]) => questionLines(q, k)),
          change:
            "To change it: reword a question or its options in this step's settings. Clear wording gives more confident answers.",
        };
      }
      if (node.type.startsWith("flowaid.decision.") && typeof config.instructions === "string") {
        const q = { ...(config as object), kind: node.type.split(".").pop() } as Question;
        return {
          summary: "Asks TypeSafe one question and records the answer with how sure it is.",
          details: [questionLines(q, "question")],
          change: "To change it: reword the question or its options in this step's settings.",
        };
      }
      if (node.type === "flowaid.data.transform" && typeof config.expr === "string")
        return {
          summary: "Works something out from earlier steps, with a formula.",
          details: describeCalculation(config.expr, def),
          change:
            "To change it: edit the formula in this step's settings. The values it uses, like limits, are workflow settings: click the empty canvas.",
        };
      return {
        summary:
          manifest?.metadata.description ??
          `A ${words(node.type.split(".").pop() ?? "task")} step.`,
        details: [],
      };
    }
    case "join":
      return {
        summary: "Waits until the steps before it have finished, then carries on.",
        details: [],
      };
    case "loop":
    case "foreach":
      return {
        summary: "Repeats the steps inside it, a set number of times or once per item.",
        details: [],
      };
    case "subflow":
      return { summary: "Runs another workflow as one step and uses its result.", details: [] };
    case "wait":
      return { summary: "Pauses the run until a time, a delay or an outside event.", details: [] };
    case "note":
      return {
        summary: "A note for people reading the canvas; it does nothing when the workflow runs.",
        details: [],
      };
  }
}

/** The workflow as a short story: its steps in the order they sit on the canvas. */
export function explainWorkflow(def: WorkflowDefinition): {
  steps: { id: string; name: string; kind: WorkflowNode["kind"]; summary: string }[];
  outcomes: string[];
  settings: string[];
  /** The settings as parts, for a layout that shows the current value on its own. */
  variables: { name: string; value?: string; description?: string }[];
} {
  const pos = (n: Node) => def.layout?.nodes[n.id] ?? { x: 0, y: 0 };
  const steps = def.nodes
    .filter((n) => n.kind !== "note" && n.kind !== "output")
    .sort((a, b) => pos(a).x - pos(b).x || pos(a).y - pos(b).y)
    .map((n) => ({ id: n.id, name: n.name, kind: n.kind, summary: explainStep(n, def).summary }));
  const outcomes = def.nodes.filter((n) => n.kind === "output").map((n) => n.name);
  const settings = def.variables.map(
    (v) =>
      `${cap(words(v.name))}${v.default !== undefined ? ` (now ${JSON.stringify(v.default)})` : ""}${v.description ? `: ${v.description}` : ""}`,
  );
  const variables = def.variables.map((v) => ({
    name: cap(words(v.name)),
    ...(v.default !== undefined ? { value: JSON.stringify(v.default) } : {}),
    ...(v.description ? { description: v.description } : {}),
  }));
  return { steps, outcomes, settings, variables };
}

// ── runs ───────────────────────────────────────────────────────────────────────────────────────

function answerText(q: Question | undefined, value: unknown): string {
  if (q?.kind === "boolean" || typeof value === "boolean") return value ? "yes" : "no";
  if (q?.kind === "score" && q.levels && typeof value === "number") {
    const level = q.levels[Math.min(Math.max(Math.round(value), 0), q.levels.length - 1)];
    return level ? `${words(level)}` : String(value);
  }
  return typeof value === "string" ? words(value) : JSON.stringify(value);
}

interface Answer {
  value?: unknown;
  confidence?: number;
}

/** How long a person took: from when the step started waiting to when it went on. */
function waitedMs(r: NodeRunView): number | undefined {
  if (r.startedAt && r.endedAt) {
    const ms = Date.parse(r.endedAt) - Date.parse(r.startedAt);
    if (Number.isFinite(ms) && ms >= 0) return ms;
  }
  // without both times, the step's own duration (for a human step it is the resume, not the wait)
  return r.durationMs;
}

/** "before the run was cancelled": why a person's step closed unanswered. */
function closedBefore(status: RunView["status"]): string {
  if (status === "cancelled") return "before the run was cancelled";
  if (status === "timed_out") return "before the run reached its time limit";
  if (status === "failed") return "before the run failed";
  return "and the step was cancelled";
}

/** A step retried in place reads once, as its latest attempt. */
function latestAttempts(nodeRuns: readonly NodeRunView[]): NodeRunView[] {
  const latest = new Map<string, NodeRunView>();
  for (const r of nodeRuns) {
    const key = `${r.scope ?? ""}|${r.nodeId}`;
    const seen = latest.get(key);
    if (!seen || r.attempt >= seen.attempt) latest.set(key, r);
  }
  return [...latest.values()];
}

const RUN_ENDED = new Set<RunView["status"]>(["completed", "failed", "cancelled", "timed_out"]);

/**
 * What happened in a run, in plain sentences, from its node runs: what came in, what each
 * decision answered and how sure it was, which way each rule sent it, what a person did (or that
 * nobody did), and how it ended. Steps that did not run are left out. `timeoutMs` is the limit a
 * timed-out run reached (its RUN_TIMED_OUT event), else the definition's; `cancelReason` is what
 * the person who cancelled it wrote.
 */
export function explainRun(
  run: Pick<RunView, "status" | "nodeRuns" | "error">,
  def?: WorkflowDefinition,
  o: { timeoutMs?: number; cancelReason?: string } = {},
): string[] {
  const lines: string[] = [];
  const runs = latestAttempts(run.nodeRuns).sort((a, b) =>
    (a.startedAt ?? "").localeCompare(b.startedAt ?? ""),
  );
  const node = (r: NodeRunView) => (def ? byId(def, r.nodeId) : undefined);
  for (const r of runs) {
    const n = node(r);
    if (r.status === "skipped" || r.status === "pending") continue;
    if (n?.kind === "input") {
      lines.push("A request came in.");
      continue;
    }
    if (r.status === "failed") {
      lines.push(`It stopped at ${quote(r.nodeName)}: ${r.error?.message ?? "the step failed"}.`);
      continue;
    }
    const out = r.output as { answers?: Record<string, Answer> } | undefined;
    if (out?.answers && typeof out.answers === "object") {
      // in the order the questions are asked, not the order the answers were stored
      const order = Object.keys(
        (n?.kind === "task" ? (n.config as { questions?: object }).questions : undefined) ?? {},
      );
      const rank = (k: string) => (order.includes(k) ? order.indexOf(k) : order.length);
      const entries = Object.entries(out.answers).sort(([a], [b]) => rank(a) - rank(b));
      const parts = entries.map(([k, a]) => {
        const q = def ? batchQuestion(def, r.nodeId, k) : undefined;
        const sure = typeof a.confidence === "number" ? ` (${pct(a.confidence)} sure)` : "";
        return `${words(k)}: ${answerText(q, a.value)}${sure}`;
      });
      lines.push(`TypeSafe checked it in ${quote(r.nodeName)}: ${list(parts)}.`);
      continue;
    }
    if (r.decision) {
      lines.push(
        `TypeSafe answered ${quote(r.nodeName)}: ${answerText(undefined, r.decision.value)} (${pct(r.decision.confidence)} sure).`,
      );
      continue;
    }
    if (n?.kind === "human" || r.category === "human") {
      const fired = r.firedPorts ?? [];
      const ms = waitedMs(r);
      const after = typeof ms === "number" ? ` after ${waited(ms)}` : "";
      const unanswered =
        r.status === "cancelled" ||
        ((r.status === "waiting" || r.status === "running") && RUN_ENDED.has(run.status));
      lines.push(
        unanswered
          ? `Nobody answered ${quote(r.nodeName)} ${closedBefore(run.status)}.`
          : r.status === "waiting"
            ? `It is waiting for a person to answer ${quote(r.nodeName)} under Human tasks.`
            : fired.includes("approved")
              ? `A person approved ${quote(r.nodeName)}${after}.`
              : fired.includes("rejected")
                ? `A person rejected ${quote(r.nodeName)}${after}.`
                : fired.includes("expired")
                  ? `Nobody answered ${quote(r.nodeName)} in time.`
                  : `A person answered ${quote(r.nodeName)}${after}.`,
      );
      continue;
    }
    if (n?.kind === "branch" || r.routeTaken) {
      const to = def && r.routeTaken ? targets(def, r.nodeId, r.routeTaken) : [];
      lines.push(
        `${quote(r.nodeName)} chose ${quote(words(r.routeTaken ?? "a path"))}${to.length ? `, so the run went to ${list(to)}` : ""}.`,
      );
      continue;
    }
    if (n?.kind === "output" && r.status === "completed") {
      lines.push(`It finished at ${quote(r.nodeName)}.`);
      continue;
    }
  }
  if (run.status === "completed" && !lines.some((l) => l.startsWith("It finished")))
    lines.push("It finished.");
  if (run.status === "failed" && !lines.some((l) => l.startsWith("It stopped")))
    lines.push(`It failed${run.error ? `: ${run.error.message}` : ""}.`);
  if (run.status === "cancelled")
    lines.push(o.cancelReason ? `It was cancelled: ${o.cancelReason}` : "It was cancelled.");
  if (run.status === "timed_out") {
    const limit = o.timeoutMs ?? def?.execution?.timeoutMs;
    lines.push(
      typeof limit === "number"
        ? `It stopped at the run's time limit of ${waited(limit)}.`
        : "It stopped at the run's time limit.",
    );
  }
  return lines;
}

/** What a person can do next with a run, by how it ended. */
export function nextForRun(run: Pick<RunView, "status" | "nodeRuns">): string[] {
  const forPerson = [
    "Open Human tasks to answer the request; the run carries on as soon as someone does.",
    "Nothing is lost while it waits, even if FlowAId restarts.",
  ];
  switch (run.status) {
    case "waiting_for_human":
      return forPerson;
    case "waiting":
      return run.nodeRuns.some((r) => r.status === "waiting" && r.category === "human")
        ? forPerson
        : ["It is paused on a wait step and carries on by itself at the set time or event."];
    case "failed":
      return [
        "In the Timeline, open the step marked failed to see its input and the error.",
        "Fix the cause (often a missing key or a changed field), then choose Retry.",
      ];
    case "timed_out":
      return [
        "No step failed: the run reached its time limit, and time spent waiting for a person counts toward it.",
        "To give it longer, raise the time limit in the workflow's settings (Open in builder), then choose Replay; Fork lets you change the input first.",
      ];
    case "completed":
      return [
        "Output shows exactly what the run returned.",
        "To try the same request again after a change, choose Replay; Fork lets you edit the input first.",
      ];
    case "cancelled":
      return ["Replay runs the same request again from the start."];
    case "queued":
    case "starting":
    case "running":
    case "retrying":
      return ["The steps light up as they run; this page updates on its own."];
  }
}
