/**
 * Pass 4 — bindings & expressions (ARCHITECTURE.md §4.1).
 *
 * Compiles every binding site of every node into a {@link CompiledBinding}: templates and
 * expressions are parsed, every reference is resolved against its producer's ports with the
 * scope rules of §2.6, and each binding is typed (the schema the runtime validates against).
 * Each port reference also yields a {@link TypedDependency} for the dependency, guard and type
 * passes. Expression typing issues (`E_EXPR_TYPE`, `W_EXPR_UNTYPED`, regex checks) are
 * reported here because the typer needs the resolved reference schemas.
 */
import Ajv2020Module from "ajv/dist/2020.js";
import {
  escapePointerToken,
  filterAcceptsContainers,
  formatRef,
  formatType,
  inferExprType,
  isBooleanType,
  isSubschema,
  mayBeContainer,
  parseExpression,
  parseTemplate,
  projectSchema,
  type Binding,
  type CompiledBinding,
  type CompiledTemplate,
  type ExprAst,
  type ExprType,
  type JsonSchema,
  type Ref,
  type TypeEnv,
} from "@flowaid/workflow-core";
import type { CompileContext, NodeInfo, TypedDependency } from "../context.js";
import { nodePath } from "../diagnostics.js";
import {
  STRING_SCHEMA,
  closedObjectSchema,
  isPlainObject,
  literalSchema,
  nullableSchema,
  tupleSchema,
} from "../util.js";

const Ajv2020 = Ajv2020Module.default;
const ajv = new Ajv2020({ strict: false, allErrors: false, validateFormats: false });

/** A place where a binding sits. */
interface Site {
  consumer: NodeInfo;
  /** The port name recorded as the dependency target. */
  port: string;
  /** JSON pointer of the binding in the definition. */
  path: string;
  /** Pointer inside the node's inputs, for `location.bindingPath`. */
  bindingPath: string;
  /** Scope the binding is evaluated in (a container's body for next/result/exitWhen/collect/reduce). */
  evalScope: string;
  /** Every reference here is optional by the node's semantics (join inputs read null when pruned). */
  optional?: boolean;
}

interface Resolution {
  schema: JsonSchema;
  typed: boolean;
  /** Present for port refs that resolved to an active producer. */
  producer?: NodeInfo;
  /** A ref with a default to a disabled node: the default is always used. */
  absent?: boolean;
}

/** `$acc`, `$value`, `$index` in `foreach.reduce` read the fold state through `$scope`. */
const REDUCE_ALIASES: Record<string, string> = {
  $acc: "$scope.carry",
  $value: "$scope.item",
  $index: "$scope.index",
};

export class BindingCompiler {
  private readonly state = new Map<string, "pending" | "done">();
  /** The typer's result for each compiled expression (for the boolean checks). */
  private readonly exprTypes = new WeakMap<CompiledBinding, ExprType>();

  constructor(private readonly ctx: CompileContext) {}

  run(): void {
    for (const info of this.ctx.active()) this.ensure(info);
  }

  /** Compiles a node's bindings once; producers with derived outputs are compiled on demand. */
  ensure(info: NodeInfo): void {
    const id = info.node.id;
    if (this.state.has(id)) return;
    this.state.set(id, "pending");
    this.compileNode(info);
    this.state.set(id, "done");
  }

  // ── scopes ────────────────────────────────────────────────────────────────

  /** The scope and every enclosing scope, innermost first. */
  scopeChain(scope: string): string[] {
    const chain: string[] = [];
    let cursor: string | undefined = scope;
    while (cursor !== undefined && !chain.includes(cursor)) {
      chain.push(cursor);
      cursor = cursor === "" ? undefined : (this.ctx.node(cursor)?.scope ?? "");
    }
    return chain;
  }

  // ── node sites ────────────────────────────────────────────────────────────

  private compileNode(info: NodeInfo): void {
    const node = info.node;
    const at = (...rest: (string | number)[]) => nodePath(info.index, ...rest);
    const site = (
      port: string,
      path: string,
      bindingPath: string,
      evalScope = info.scope,
    ): Site => ({
      consumer: info,
      port,
      path,
      bindingPath,
      evalScope,
    });
    switch (node.kind) {
      case "input":
      case "note":
        return;
      case "output":
        info.compiled.set("value", this.binding(node.value, site("value", at("value"), "/value")));
        return;
      case "task": {
        for (const [port, binding] of Object.entries(node.inputs)) {
          const pointer = "/" + escapePointerToken(port);
          const compiled = this.binding(binding, site(port, at("inputs", port), pointer));
          info.compiled.set(port, compiled);
          this.checkTaskInput(info, port, binding, compiled, at("inputs", port));
        }
        this.checkRequiredInputs(info);
        for (const [key, value] of Object.entries(node.config)) {
          const pointer = "/" + escapePointerToken(key);
          const port = configPort(key);
          if (info.configExpressions.has(pointer) && typeof value === "string") {
            const compiled = this.expr(value, site(port, at("config", key), pointer));
            info.configBindings.set(pointer, compiled);
            this.checkExpressionResult(info, compiled, at("config", key));
          } else if (info.configBindings.has(pointer)) {
            const compiled = this.binding(value as Binding, site(port, at("config", key), pointer));
            info.configBindings.set(pointer, compiled);
            this.checkConfigBinding(info, key, compiled, at("config", key));
          } else if (info.configTemplates.has(pointer)) {
            const template = info.configTemplates.get(pointer);
            if (template) this.template(template, site(port, at("config", key), pointer));
          }
        }
        return;
      }
      case "branch":
        node.cases.forEach((c, i) => {
          const s = site(c.port, at("cases", i, "when"), `/cases/${i}/when`);
          const compiled = this.expr(c.when, s);
          info.compiled.set(`when/${i}`, compiled);
          this.requireBoolean(compiled, s, `Case '${c.port}'`);
        });
        return;
      case "join":
        for (const [name, binding] of Object.entries(node.inputs)) {
          const s = { ...site(name, at("inputs", name), `/${name}`), optional: true };
          info.compiled.set(name, this.binding(binding, s));
        }
        info.outputs.set(
          "values",
          closedObjectSchema(
            Object.fromEntries(
              [...Object.keys(node.inputs)].map((name) => [
                name,
                nullableSchema(info.compiled.get(name)?.schema ?? {}),
              ]),
            ),
          ),
        );
        if (Object.keys(node.inputs).length > 0) {
          info.outputs.set("first", {
            anyOf: [{ enum: Object.keys(node.inputs) }, { type: "null" }],
          });
        }
        return;
      case "loop": {
        const body = node.id;
        for (const [key, binding] of Object.entries(node.carry.next)) {
          info.compiled.set(
            `next/${key}`,
            this.binding(
              binding,
              site("next", at("carry", "next", key), `/carry/next/${key}`, body),
            ),
          );
        }
        for (const [key, binding] of Object.entries(node.result)) {
          info.compiled.set(
            `result/${key}`,
            this.binding(binding, site("result", at("result", key), `/result/${key}`, body)),
          );
        }
        if (node.exitWhen !== undefined) {
          const s = site("exit_when", at("exitWhen"), "/exitWhen", body);
          const compiled = this.expr(node.exitWhen, s);
          info.compiled.set("exitWhen", compiled);
          this.requireBoolean(compiled, s, "exitWhen");
        }
        info.outputs.set(
          "result",
          closedObjectSchema(
            Object.fromEntries(
              Object.keys(node.result).map((k) => [
                k,
                info.compiled.get(`result/${k}`)?.schema ?? {},
              ]),
            ),
          ),
        );
        return;
      }
      case "foreach": {
        const items = this.binding(node.items, site("items", at("items"), "/items"));
        info.compiled.set("items", items);
        if (node.collect) {
          const collect = this.binding(
            node.collect,
            site("collect", at("collect"), "/collect", node.id),
          );
          info.compiled.set("collect", collect);
          info.outputs.set("results", { type: "array", items: collect.schema });
        }
        if (node.reduce) {
          let source = node.reduce.expr;
          for (const [alias, target] of Object.entries(REDUCE_ALIASES)) {
            source = source.split(alias).join(target);
          }
          const reduced = this.expr(
            source,
            site("reduce", at("reduce", "expr"), "/reduce/expr", node.id),
          );
          info.compiled.set("reduce", reduced);
          info.outputs.set("reduced", reduced.schema);
        }
        return;
      }
      case "subflow": {
        const childProps = isPlainObject(info.subflowSignature?.inputs.properties)
          ? info.subflowSignature.inputs.properties
          : {};
        for (const [key, binding] of Object.entries(node.inputs)) {
          const compiled = this.binding(binding, site(portOf(key), at("inputs", key), `/${key}`));
          info.compiled.set(key, compiled);
          const target = childProps[key];
          if (target) this.recordTypeCheck(info, key, compiled, target, at("inputs", key));
        }
        return;
      }
      case "wait":
        if (node.until.type === "timestamp") {
          info.compiled.set(
            "at",
            this.binding(node.until.at, site("at", at("until", "at"), "/until/at")),
          );
        }
        return;
      case "human": {
        if (node.mode.type === "review") {
          info.compiled.set(
            "value",
            this.binding(node.mode.value, site("value", at("mode", "value"), "/mode/value")),
          );
        }
        info.compiled.set("title", this.binding(node.title, site("title", at("title"), "/title")));
        for (const [key, binding] of Object.entries(node.context)) {
          info.compiled.set(
            `context/${key}`,
            this.binding(binding, site("context", at("context", key), `/context/${key}`)),
          );
        }
        return;
      }
    }
  }

  // ── bindings ──────────────────────────────────────────────────────────────

  binding(binding: Binding, site: Site): CompiledBinding {
    switch (binding.kind) {
      case "literal":
        return { kind: "literal", value: binding.value, schema: literalSchema(binding.value) };
      case "ref": {
        const optional = binding.default !== undefined || site.optional === true;
        const resolved = this.resolve(binding.ref, site, { optional, via: "ref", bare: !optional });
        const compiled: CompiledBinding = {
          kind: "ref",
          ref: binding.ref,
          optional,
          schema: resolved.schema,
        };
        if (binding.default !== undefined) compiled.default = binding.default;
        return compiled;
      }
      case "template": {
        const parsed = parseTemplate(binding.source);
        if (!parsed.ok) {
          this.ctx.diagnostics.add("E_TEMPLATE_SYNTAX", parsed.message, {
            nodeId: site.consumer.node.id,
            path: site.path,
            bindingPath: site.bindingPath,
            range: { start: parsed.offset, end: parsed.offset + 1 },
          });
          return {
            kind: "template",
            template: { parts: [{ kind: "text", text: binding.source }] },
            schema: STRING_SCHEMA,
          };
        }
        this.template(parsed.template, site);
        return { kind: "template", template: parsed.template, schema: STRING_SCHEMA };
      }
      case "expr":
        return this.expr(binding.source, site);
      case "object": {
        const fields: Record<string, CompiledBinding> = {};
        for (const [key, field] of Object.entries(binding.fields)) {
          fields[key] = this.binding(field, {
            ...site,
            path: `${site.path}/fields/${escapePointerToken(key)}`,
            bindingPath: `${site.bindingPath}/${escapePointerToken(key)}`,
          });
        }
        return {
          kind: "object",
          fields,
          schema: closedObjectSchema(
            Object.fromEntries(Object.entries(fields).map(([k, f]) => [k, f.schema])),
          ),
        };
      }
      case "array": {
        const items = binding.items.map((item, i) =>
          this.binding(item, {
            ...site,
            path: `${site.path}/items/${i}`,
            bindingPath: `${site.bindingPath}/${i}`,
          }),
        );
        return { kind: "array", items, schema: tupleSchema(items.map((i) => i.schema)) };
      }
    }
  }

  /** Resolves and types the holes of a template; returns nothing (a template is always a string). */
  template(template: CompiledTemplate, site: Site): void {
    for (const part of template.parts) {
      if (part.kind !== "hole") continue;
      const optionalKeys = optionalRefs(part.expr);
      const env = this.typeEnv(part.expr, site, "template", optionalKeys);
      const typed = inferExprType(part.expr, env);
      const range = { start: part.range.start, end: part.range.end };
      this.reportIssues(typed.issues, site, range, true);
      if (
        !filterAcceptsContainers(part.filter) &&
        mayBeContainer(typed.type) &&
        typed.type.kind !== "unknown"
      ) {
        this.ctx.diagnostics.add(
          "E_TEMPLATE_OBJECT_COERCION",
          `This hole may render an object or array as text; add '| json' (or pick a scalar field)`,
          { nodeId: site.consumer.node.id, path: site.path, bindingPath: site.bindingPath, range },
        );
      }
    }
  }

  expr(source: string, site: Site): CompiledBinding {
    const parsed = parseExpression(source);
    if (!parsed.ok) {
      this.ctx.diagnostics.add("E_EXPR_SYNTAX", parsed.message, {
        nodeId: site.consumer.node.id,
        path: site.path,
        bindingPath: site.bindingPath,
        range: { start: parsed.offset, end: Math.min(parsed.offset + 1, source.length) },
      });
      return { kind: "expr", ast: { kind: "literal", value: null }, schema: {} };
    }
    const env = this.typeEnv(parsed.ast, site, "expr", optionalRefs(parsed.ast));
    const typed = inferExprType(parsed.ast, env);
    this.reportIssues(typed.issues, site, { start: 0, end: source.length }, false);
    const compiled: CompiledBinding = { kind: "expr", ast: parsed.ast, schema: typed.schema };
    this.exprTypes.set(compiled, typed.type);
    return compiled;
  }

  /** Resolves every ref of an AST once (recording dependencies) and serves their schemas to the typer. */
  private typeEnv(
    ast: ExprAst,
    site: Site,
    via: "template" | "expr",
    optionalKeys: Set<string>,
  ): TypeEnv {
    const schemas = new Map<string, JsonSchema | undefined>();
    const bareKeys = bareRefs(ast);
    for (const ref of collectAllRefs(ast)) {
      const key = formatRef(ref);
      if (schemas.has(key)) continue;
      const optional = site.optional === true || (optionalKeys.has(key) && !bareKeys.has(key));
      const resolved = this.resolve(ref, site, { optional, via, bare: !optional });
      schemas.set(key, resolved.typed ? resolved.schema : undefined);
    }
    return { schemaOf: (ref) => schemas.get(formatRef(ref)) };
  }

  private reportIssues(
    issues: readonly { code: string; message: string }[],
    site: Site,
    range: { start: number; end: number },
    inTemplate: boolean,
  ): void {
    for (const issue of issues) {
      const code =
        issue.code === "type"
          ? "E_EXPR_TYPE"
          : issue.code === "untyped"
            ? "W_EXPR_UNTYPED"
            : issue.code === "regex_dynamic"
              ? "E_EXPR_REGEX_DYNAMIC"
              : "E_EXPR_REGEX_UNSAFE";
      // A template hole renders any value as text; untyped operands there are expected.
      if (inTemplate && code === "W_EXPR_UNTYPED") continue;
      this.ctx.diagnostics.add(code, issue.message, {
        nodeId: site.consumer.node.id,
        path: site.path,
        bindingPath: site.bindingPath,
        range,
      });
    }
  }

  private requireBoolean(compiled: CompiledBinding, site: Site, what: string): void {
    const type = this.exprTypes.get(compiled);
    if (!type || type.kind === "unknown" || isBooleanType(type)) return;
    this.ctx.diagnostics.add(
      "E_EXPR_NOT_BOOLEAN",
      `${what} must be a boolean expression (it is ${formatType(type)})`,
      {
        nodeId: site.consumer.node.id,
        path: site.path,
        bindingPath: site.bindingPath,
      },
    );
  }

  // ── references ────────────────────────────────────────────────────────────

  resolve(
    ref: Ref,
    site: Site,
    how: { optional: boolean; via: TypedDependency["via"]; bare: boolean },
  ): Resolution {
    const { ctx } = this;
    const consumer = site.consumer;
    const where = { nodeId: consumer.node.id, path: site.path, bindingPath: site.bindingPath };
    switch (ref.kind) {
      case "var": {
        const variable = ctx.definition.variables.find((v) => v.name === ref.name);
        ctx.usedVariables.add(ref.name);
        if (!variable) {
          ctx.diagnostics.add("E_VARIABLE_UNDECLARED", `$vars.${ref.name} is not declared`, where, {
            fix: {
              title: `Declare $vars.${ref.name}`,
              patch: [{ op: "add", path: "/variables/-", value: { name: ref.name, schema: {} } }],
            },
          });
          return { schema: {}, typed: false };
        }
        return { schema: variable.schema, typed: true };
      }
      case "run":
        return { schema: RUN_FIELD_SCHEMAS[ref.field] ?? {}, typed: true };
      case "scope": {
        const container = ctx.node(site.evalScope);
        if (site.evalScope === "" || !container) {
          ctx.diagnostics.add(
            "E_SCOPE_REF_OUTSIDE_SCOPE",
            `$scope.${ref.field} is only available inside a loop or foreach body`,
            where,
          );
          return { schema: {}, typed: false };
        }
        const field = ref.field;
        const kind = container.node.kind;
        const valid =
          kind === "foreach"
            ? field === "item" || field === "index"
            : field === "iteration" || field === "carry";
        if (!valid) {
          ctx.diagnostics.add(
            "E_SCOPE_REF_OUTSIDE_SCOPE",
            `$scope.${field} is not available in a ${kind} body (use ${kind === "foreach" ? "item or index" : "iteration or carry"})`,
            where,
          );
          return { schema: {}, typed: false };
        }
        const base = this.scopeFieldSchema(container, field);
        return this.project(base, ref, site);
      }
      case "port": {
        const producer = ctx.node(ref.node);
        if (!producer || producer.node.kind === "note") {
          ctx.diagnostics.add("E_REF_UNKNOWN_NODE", `No node '${ref.node}'`, where);
          return { schema: {}, typed: false };
        }
        if (ctx.dropped.has(ref.node)) {
          if (how.optional) return { schema: {}, typed: false, absent: true };
          ctx.diagnostics.add(
            "E_REF_UNKNOWN_NODE",
            `'${ref.node}' is disabled; enable it or give this reference a default`,
            where,
          );
          return { schema: {}, typed: false };
        }
        if (producer.node.id === consumer.node.id) {
          ctx.diagnostics.add(
            "E_REF_SELF",
            `'${consumer.node.id}' cannot read its own output`,
            where,
          );
          return { schema: {}, typed: false };
        }
        const chain = this.scopeChain(site.evalScope);
        if (!chain.includes(producer.scope)) {
          ctx.diagnostics.add(
            "E_REF_SCOPE_VIOLATION",
            `'${ref.node}' is inside ${producer.scope ? `'${producer.scope}'` : "another scope"}; read it through that container's outputs`,
            where,
          );
          return { schema: {}, typed: false };
        }
        if (
          producer.node.kind === "join" ||
          producer.node.kind === "loop" ||
          producer.node.kind === "foreach"
        ) {
          if (this.state.get(producer.node.id) !== "pending") this.ensure(producer);
        }
        ctx.readNodes.add(producer.node.id);
        const portSchema = producer.outputs.get(ref.port);
        if (portSchema === undefined) {
          if (!producer.unresolved) {
            ctx.diagnostics.add(
              "E_REF_UNKNOWN_PORT",
              `'${ref.node}' has no output '${ref.port}' (outputs: ${[...producer.outputs.keys()].join(", ") || "none"})`,
              { ...where, port: ref.port },
            );
          }
          this.record(producer, ref, site, how, undefined);
          return { schema: {}, typed: false, producer };
        }
        const resolved = this.project(portSchema, ref, site);
        this.record(producer, ref, site, how, resolved.typed ? resolved.schema : undefined);
        return { ...resolved, producer };
      }
    }
  }

  private project(
    base: JsonSchema,
    ref: Extract<Ref, { kind: "port" | "scope" }>,
    site: Site,
  ): Resolution {
    const path = ref.path;
    if (path === undefined) return { schema: base, typed: true };
    const projected = projectSchema(base, path);
    const label = formatRef(ref);
    const where = { nodeId: site.consumer.node.id, path: site.path, bindingPath: site.bindingPath };
    if (!projected.ok) {
      this.ctx.diagnostics.add("E_REF_PATH_INVALID", `${label}: ${projected.reason}`, where);
      return { schema: {}, typed: false };
    }
    if (!projected.typed) {
      this.ctx.diagnostics.add(
        "W_REF_PATH_UNTYPED",
        `${label} is not described by the producer's schema; it is checked at run time`,
        where,
      );
      return { schema: {}, typed: false };
    }
    return { schema: projected.schema, typed: true };
  }

  private scopeFieldSchema(container: NodeInfo, field: string): JsonSchema {
    const node = container.node;
    if (field === "index" || field === "iteration") return { type: "integer", minimum: 0 };
    if (node.kind === "loop") return node.carrySchema;
    if (node.kind === "foreach") {
      if (node.itemSchema) return node.itemSchema;
      if (this.state.get(node.id) !== "pending") this.ensure(container);
      const items = container.compiled.get("items")?.schema;
      if (items && isPlainObject(items.items)) return items.items;
      if (items && Array.isArray(items.prefixItems) && items.prefixItems.length > 0) {
        return { anyOf: items.prefixItems };
      }
    }
    return {};
  }

  /** Records the dependency on the consumer, and a hoisted one on the container that encloses it. */
  private record(
    producer: NodeInfo,
    ref: Extract<Ref, { kind: "port" }>,
    site: Site,
    how: { optional: boolean; via: TypedDependency["via"]; bare: boolean },
    sourceSchema: JsonSchema | undefined,
  ): void {
    const consumer = site.consumer;
    // Body-scope bindings of a container never depend on the container's own body nodes.
    const bodyBinding = site.evalScope !== consumer.scope;
    const insideBody =
      bodyBinding &&
      producer.scope !== consumer.scope &&
      this.scopeChain(producer.scope).includes(site.evalScope);
    if (!insideBody) {
      this.addDependency(consumer, {
        from: { node: producer.node.id, port: ref.port },
        to: { node: consumer.node.id, port: site.port },
        ...(ref.path !== undefined ? { path: ref.path } : {}),
        optional: how.optional,
        via: producer.scope === consumer.scope ? how.via : "hoisted",
        sourceSchema,
        bindingPath: site.bindingPath,
        definitionPath: site.path,
        bare: how.bare,
      });
    }
    // Outward reads from a body: the container directly inside the producer's scope waits for it.
    if (producer.scope !== site.evalScope) {
      const chain = this.scopeChain(site.evalScope);
      const idx = chain.indexOf(producer.scope);
      const containerId = idx > 0 ? chain[idx - 1] : undefined;
      const container = containerId ? this.ctx.node(containerId) : undefined;
      if (container && container.node.id !== consumer.node.id) {
        this.addDependency(container, {
          from: { node: producer.node.id, port: ref.port },
          to: { node: container.node.id, port: "body" },
          ...(ref.path !== undefined ? { path: ref.path } : {}),
          optional: how.optional,
          via: "hoisted",
          sourceSchema,
          bindingPath: site.bindingPath,
          definitionPath: site.path,
          bare: false,
        });
      }
    }
  }

  private addDependency(info: NodeInfo, dep: TypedDependency): void {
    const key = (d: TypedDependency) =>
      `${d.to.port}|${d.from.node}.${d.from.port}${d.path ?? ""}|${d.via}`;
    const k = key(dep);
    const existing = info.dataIn.find((d) => key(d) === k);
    if (existing) {
      // A value read bare anywhere is required.
      if (!dep.optional) existing.optional = false;
      if (dep.bare) existing.bare = true;
      return;
    }
    info.dataIn.push(dep);
  }

  // ── port checks ───────────────────────────────────────────────────────────

  private checkTaskInput(
    info: NodeInfo,
    port: string,
    binding: Binding,
    compiled: CompiledBinding,
    path: string,
  ): void {
    const spec = info.inputPorts.get(port);
    const where = { nodeId: info.node.id, path, port };
    if (!spec && !info.dynamicInputSchema) {
      if (!info.unresolved) {
        this.ctx.diagnostics.add(
          "E_INPUT_UNKNOWN_PORT",
          `'${info.node.id}' has no input '${port}' (inputs: ${[...info.inputPorts.keys()].join(", ") || "none"})`,
          where,
        );
      }
      return;
    }
    const target = spec?.schema ?? info.dynamicInputSchema ?? {};
    if (binding.kind === "literal") {
      let valid = true;
      try {
        valid = ajv.validate(target as object, binding.value);
      } catch {
        valid = true;
      }
      if (!valid) {
        this.ctx.diagnostics.add(
          "E_INPUT_LITERAL_INVALID",
          `The literal for '${port}' does not match its schema: ${ajv.errorsText(ajv.errors)}`,
          where,
        );
      }
      return;
    }
    this.recordTypeCheck(info, port, compiled, target, path);
  }

  private checkConfigBinding(
    info: NodeInfo,
    key: string,
    compiled: CompiledBinding,
    path: string,
  ): void {
    const props = info.manifest?.configSchema.properties;
    const target = isPlainObject(props) ? props[key] : undefined;
    if (target) this.recordTypeCheck(info, key, compiled, stripUiHints(target), path);
  }

  /**
   * A config expression that computes the node's only output (Transform) must fit the output
   * schema declared by the node's outputSchemaFromConfig rule.
   */
  private checkExpressionResult(info: NodeInfo, compiled: CompiledBinding, path: string): void {
    const outputs = info.manifest?.outputs ?? [];
    const rule = info.manifest?.portRules.find((r) => r.kind === "outputSchemaFromConfig");
    if (outputs.length !== 1 || !rule || rule.kind !== "outputSchemaFromConfig") return;
    const declared = info.outputs.get(rule.port);
    if (declared) this.recordTypeCheck(info, rule.port, compiled, declared, path);
  }

  /** Queues a producer→port type check for the type pass. */
  private recordTypeCheck(
    info: NodeInfo,
    port: string,
    compiled: CompiledBinding,
    target: JsonSchema,
    path: string,
  ): void {
    this.ctx.typeChecks.push({ info, port, compiled, target, path });
  }

  private checkRequiredInputs(info: NodeInfo): void {
    if (info.node.kind !== "task" || info.unresolved) return;
    const bound = info.node.inputs;
    for (const spec of info.inputPorts.values()) {
      if (!spec.required || Object.hasOwn(bound, spec.name)) continue;
      const candidates = this.candidatesFor(info, spec.schema);
      this.ctx.diagnostics.add(
        "E_INPUT_REQUIRED_MISSING",
        `Input '${spec.name}' of '${info.node.id}' is required`,
        { nodeId: info.node.id, path: nodePath(info.index, "inputs"), port: spec.name },
        candidates.length > 0
          ? {
              fix: {
                title: `Bind ${spec.name} to ${candidates[0]?.node}.${candidates[0]?.port}`,
                patch: [
                  {
                    op: "add",
                    path: `${nodePath(info.index, "inputs")}/${escapePointerToken(spec.name)}`,
                    value: {
                      kind: "ref",
                      ref: {
                        kind: "port",
                        node: candidates[0]?.node ?? "",
                        port: candidates[0]?.port ?? "",
                      },
                    },
                  },
                ],
              },
              related: candidates.map((c) => ({
                nodeId: c.node,
                message: `candidate: ${c.node}.${c.port}`,
              })),
            }
          : {},
      );
    }
  }

  /** Up to three outputs in scope whose schema fits `target` (for quick fixes). */
  private candidatesFor(info: NodeInfo, target: JsonSchema): { node: string; port: string }[] {
    const chain = this.scopeChain(info.scope);
    const out: { node: string; port: string }[] = [];
    for (const other of this.ctx.active()) {
      if (other === info || !chain.includes(other.scope)) continue;
      for (const [port, schema] of other.outputs) {
        const fit = isSubschema(schema, target);
        if (fit.ok && fit.verified) out.push({ node: other.node.id, port });
        if (out.length >= 3) return out;
      }
    }
    return out;
  }
}

/** `$run` field schemas. */
const RUN_FIELD_SCHEMAS: Record<string, JsonSchema> = {
  id: STRING_SCHEMA,
  workflowId: STRING_SCHEMA,
  workflowVersionId: STRING_SCHEMA,
  environment: STRING_SCHEMA,
  startedAt: { type: "string", format: "date-time" },
  sessionId: { type: ["string", "null"] },
};

/** The dependency port for a config field: its top-level key when it is a valid port name. */
function configPort(key: string): string {
  return portOf(key);
}

function portOf(key: string): string {
  const snake = key.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
  return /^[a-z][a-z0-9_]{0,63}$/.test(snake) ? snake : "config";
}

function stripUiHints(schema: JsonSchema): JsonSchema {
  const { "x-ui": _ui, ...rest } = schema as JsonSchema & { "x-ui"?: unknown };
  return rest;
}

/** Every ref of an AST (including lambda bodies), first appearance first. */
function collectAllRefs(ast: ExprAst): Ref[] {
  const out = new Map<string, Ref>();
  walk(ast, (node) => {
    if (node.kind === "ref") {
      const key = formatRef(node.ref);
      if (!out.has(key)) out.set(key, node.ref);
    }
  });
  return [...out.values()];
}

/** Keys of refs that appear inside a `coalesce(...)` call. */
function optionalRefs(ast: ExprAst): Set<string> {
  const keys = new Set<string>();
  walk(ast, (node) => {
    if (node.kind === "call" && node.fn === "coalesce") {
      for (const arg of node.args) for (const ref of collectAllRefs(arg)) keys.add(formatRef(ref));
    }
  });
  return keys;
}

/** Keys of refs that appear outside every `coalesce(...)` call. */
function bareRefs(ast: ExprAst): Set<string> {
  const keys = new Set<string>();
  const visit = (node: ExprAst): void => {
    if (node.kind === "call" && node.fn === "coalesce") return;
    if (node.kind === "ref") keys.add(formatRef(node.ref));
    forEachChild(node, visit);
  };
  visit(ast);
  return keys;
}

function walk(ast: ExprAst, fn: (node: ExprAst) => void): void {
  fn(ast);
  forEachChild(ast, (child) => walk(child, fn));
}

function forEachChild(ast: ExprAst, fn: (node: ExprAst) => void): void {
  switch (ast.kind) {
    case "unary":
      fn(ast.operand);
      return;
    case "binary":
      fn(ast.left);
      fn(ast.right);
      return;
    case "ternary":
      fn(ast.test);
      fn(ast.then);
      fn(ast.else);
      return;
    case "member":
      fn(ast.object);
      return;
    case "index":
      fn(ast.object);
      fn(ast.index);
      return;
    case "call":
      ast.args.forEach(fn);
      return;
    case "lambda":
      fn(ast.body);
      return;
    case "array":
      ast.items.forEach(fn);
      return;
    case "object":
      ast.entries.forEach((e) => fn(e.value));
      return;
    case "literal":
    case "ref":
    case "ident":
      return;
  }
}

export function bindingsPass(ctx: CompileContext): BindingCompiler {
  const compiler = new BindingCompiler(ctx);
  compiler.run();
  return compiler;
}
