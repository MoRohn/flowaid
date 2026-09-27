/**
 * `generateWorkflowTs(def)` (CODE_EXPORT.md §3): the workflow as typed code over the SDK builders
 * (API.md §8.1), formatted with Prettier. The generator is total over `WorkflowDefinitionSchema`:
 * it parses the document first (so every default is explicit), emits every field except those
 * equal to their schema default, and renders every binding position with the binding builders.
 * `evaluateWorkflowTs(source)` runs the generated module against the real builders, and
 * `assertRoundTrip` fails with CODEGEN_ROUNDTRIP when the result hashes differently.
 */
import { runInNewContext } from "node:vm";
import { format } from "prettier/standalone";
import * as estree from "prettier/plugins/estree";
import * as typescript from "prettier/plugins/typescript";
import { builders } from "@flowaid/workflow-sdk/builders";
import {
  FlowaidError,
  InternalError,
  WorkflowDefinitionSchema,
  definitionHash,
  type Binding,
  type JsonValue,
  type Trigger,
  type WorkflowDefinition,
  type WorkflowNode,
} from "@flowaid/workflow-core";
import { call, type Code } from "./literal.js";

/**
 * The generated module does not reproduce the definition (CODE_EXPORT.md §3): the export fails
 * rather than ship a package that differs from what the user built. `details.reason` is
 * `CODEGEN_ROUNDTRIP`.
 */
export class CodegenRoundTripError extends InternalError {
  constructor(message: string) {
    super(message, { reason: "CODEGEN_ROUNDTRIP" });
  }
}

/** The module specifier generated workflows import their builders from. */
export const SDK_MODULE = "@flowaid/workflow-sdk";

class Emitter {
  readonly used = new Set<string>();

  fn(name: string, ...args: unknown[]): Code {
    this.used.add(name.split(".")[0] ?? name);
    return call(name, ...args);
  }

  binding(b: Binding): Code {
    switch (b.kind) {
      case "literal":
        return this.fn("lit", b.value);
      case "template":
        return this.fn("tpl", b.source);
      case "expr":
        return this.fn("expr", b.source);
      case "object":
        return this.fn("obj", this.bindings(b.fields));
      case "array":
        return this.fn(
          "arr",
          b.items.map((i) => this.binding(i)),
        );
      case "ref": {
        const r = b.ref;
        const base =
          r.kind === "port"
            ? this.fn("ref", r.node, r.port, r.path)
            : r.kind === "var"
              ? this.fn("ref.var", r.name)
              : r.kind === "scope"
                ? this.fn("ref.scope", r.field, r.path)
                : this.fn("ref.run", r.field);
        return b.default === undefined ? base : call(`${base.source}.default`, b.default);
      }
    }
  }

  bindings(map: Record<string, Binding>): Record<string, Code> {
    return Object.fromEntries(Object.entries(map).map(([k, v]) => [k, this.binding(v)]));
  }

  node(n: WorkflowNode): Code {
    const common = {
      description: n.description,
      parent: n.parent,
      disabled: n.disabled ? true : undefined,
      policy: n.policy,
    };
    switch (n.kind) {
      case "input":
        return this.fn("input", n.name, nonEmpty(common));
      case "output":
        return this.fn("output", n.name, {
          value: this.binding(n.value),
          outcome: n.outcome,
          earlyExit: n.earlyExit ? true : undefined,
          ...common,
        });
      case "task":
        return this.fn("task", n.type, {
          typeVersion: n.typeVersion,
          name: n.name,
          config: nonEmpty(n.config),
          inputs: nonEmpty(this.bindings(n.inputs)),
          credentials: nonEmpty(n.credentials),
          ...common,
        });
      case "branch":
        return this.fn("branch", n.name, {
          mode: n.mode === "first" ? undefined : n.mode,
          cases: n.cases,
          defaultPort: n.defaultPort === "default" ? undefined : n.defaultPort,
          ...common,
        });
      case "join":
        return this.fn("join", n.name, {
          mode: n.mode.type === "all" ? undefined : n.mode,
          timeoutMs: n.timeoutMs,
          inputs: nonEmpty(this.bindings(n.inputs)),
          ...common,
        });
      case "loop":
        return this.fn("loop", n.name, {
          carrySchema: n.carrySchema,
          carry: { initial: n.carry.initial, next: this.bindings(n.carry.next) },
          result: nonEmpty(this.bindings(n.result)),
          exitWhen: n.exitWhen,
          bounds: n.bounds,
          onExhausted: n.onExhausted === "route" ? undefined : n.onExhausted,
          ...common,
        });
      case "foreach":
        return this.fn("foreach", n.name, {
          items: this.binding(n.items),
          itemSchema: n.itemSchema,
          concurrency: n.concurrency === 4 ? undefined : n.concurrency,
          failurePolicy: n.failurePolicy === "fail_fast" ? undefined : n.failurePolicy,
          bounds: n.bounds,
          collect: n.collect ? this.binding(n.collect) : undefined,
          reduce: n.reduce,
          ...common,
        });
      case "subflow":
        return this.fn("subflow", n.name, {
          workflowId: n.workflowId,
          version: n.version === "deployed" ? undefined : n.version,
          inputs: nonEmpty(this.bindings(n.inputs)),
          timeoutMs: n.timeoutMs,
          ...common,
        });
      case "wait":
        return this.fn("wait", n.name, {
          until:
            n.until.type === "timestamp"
              ? { type: "timestamp", at: this.binding(n.until.at) }
              : n.until,
          ...common,
        });
      case "human":
        return this.fn("human", n.name, {
          mode:
            n.mode.type === "review"
              ? { type: "review", value: this.binding(n.mode.value), schema: n.mode.schema }
              : n.mode,
          title: this.binding(n.title),
          context: nonEmpty(this.bindings(n.context)),
          assignees: n.assignees.length > 0 ? n.assignees : undefined,
          expiresInMs: n.expiresInMs,
          onExpire: n.onExpire === "fail" ? undefined : n.onExpire,
          escalation: n.escalation,
          externalReview: n.externalReview ? true : undefined,
          ...common,
        });
      case "note":
        return this.fn("note", n.text, { name: n.name, ...common });
    }
  }

  trigger(t: Trigger): Code {
    if (t.type === "manual") return this.fn("trigger.manual");
    const { type, ...rest } = t;
    return this.fn(`trigger.${type}`, rest);
  }

  document(def: WorkflowDefinition): Code {
    return this.fn("defineWorkflow", {
      id: def.id,
      name: def.name,
      description: def.description === "" ? undefined : def.description,
      inputs: def.inputs,
      outputs: def.outputs,
      variables: nonEmptyList(
        def.variables.map((v) =>
          this.fn(
            "variable",
            v.name,
            v.schema,
            nonEmpty({
              default: v.default,
              source: v.source === "definition" ? undefined : v.source,
              description: v.description,
            }),
          ),
        ),
      ),
      secrets: nonEmptyList(
        def.secrets.map((s) =>
          this.fn(
            "secret",
            s.name,
            s.credentialType,
            nonEmpty({ required: s.required ? undefined : false, description: s.description }),
          ),
        ),
      ),
      triggers: nonEmptyList(def.triggers.map((t) => this.trigger(t))),
      execution: def.execution,
      nodes: Object.fromEntries(def.nodes.map((n) => [n.id, this.node(n)])),
      edges: nonEmptyList(
        def.edges.map((e) =>
          this.fn("edge", { node: e.from.node, port: e.from.port }, e.to.node, e.id),
        ),
      ),
      layout: def.layout,
      metadata: nonEmpty(def.metadata),
    });
  }
}

function nonEmpty<T extends object>(value: T): T | undefined {
  return Object.values(value).some((v) => v !== undefined) ? value : undefined;
}
function nonEmptyList<T>(list: T[]): T[] | undefined {
  return list.length > 0 ? list : undefined;
}

export interface GenerateWorkflowTsOptions {
  /** A line for the header comment, e.g. "Support triage v3". */
  title?: string;
  /** Skip Prettier (tests of the raw generator). */
  raw?: boolean;
}

/** `src/workflow.ts` for a definition: a module whose `workflow` (and default) export is the document. */
export async function generateWorkflowTs(
  def: unknown,
  opts: GenerateWorkflowTsOptions = {},
): Promise<string> {
  const parsed = WorkflowDefinitionSchema.parse(def);
  const emitter = new Emitter();
  const body = emitter.document(parsed);
  const imports = [...emitter.used].sort();
  // A comment may not contain "*/" or line breaks from the document.
  const title = (opts.title ?? parsed.name)
    .replace(/\*\//g, "* /")
    .replace(/[\r\n\u2028\u2029]+/g, " ");
  const header = [
    "/**",
    ` * ${title} — generated by FlowAId from the workflow definition.`,
    " * Edit freely: `pnpm validate` compiles it and reports what changed against workflow.plan.json.",
    " */",
  ].join("\n");
  const source = `${header}\nimport { ${imports.join(", ")} } from ${JSON.stringify(SDK_MODULE)};\n\nexport const workflow = ${body.source};\n\nexport default workflow;\n`;
  if (opts.raw) return source;
  return format(source, {
    parser: "typescript",
    plugins: [estree, typescript],
    printWidth: 100,
  });
}

const IMPORT = /^import\s*\{[^}]*\}\s*from\s*"@flowaid\/workflow-sdk";?\s*$/m;
const EXPORT_CONST = /^export const workflow\s*=/m;
const EXPORT_DEFAULT = /^export default workflow;?\s*$/m;

/**
 * Evaluates a generated `src/workflow.ts` against the real SDK builders and returns the document.
 * Only the shape {@link generateWorkflowTs} emits is accepted (one builder import, one
 * `export const workflow = …`, one default export); anything else throws.
 */
export function evaluateWorkflowTs(source: string): unknown {
  if (!IMPORT.test(source) || !EXPORT_CONST.test(source) || !EXPORT_DEFAULT.test(source))
    throw new CodegenRoundTripError(
      "src/workflow.ts is not in the generated shape (builder import, `export const workflow`, default export)",
    );
  const script = source
    .replace(IMPORT, "")
    .replace(EXPORT_CONST, "globalThis.__workflow =")
    .replace(EXPORT_DEFAULT, "");
  const context: Record<string, unknown> = { ...builders, __workflow: undefined };
  runInNewContext(script, context, { timeout: 5_000, filename: "workflow.ts" });
  // Back into this realm as plain JSON (the builders already produce plain JSON).
  return JSON.parse(JSON.stringify(context.__workflow)) as JsonValue;
}

/** Throws CODEGEN_ROUNDTRIP unless the generated module yields a document with the source's hash. */
export function assertRoundTrip(def: unknown, source: string): string {
  const expected = definitionHash(def);
  let actual: string;
  try {
    actual = definitionHash(evaluateWorkflowTs(source));
  } catch (error) {
    if (error instanceof FlowaidError) throw error;
    throw new CodegenRoundTripError(
      `the generated workflow does not evaluate: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (actual !== expected)
    throw new CodegenRoundTripError(
      `the generated workflow hashes to ${actual}, the definition to ${expected}`,
    );
  return expected;
}
