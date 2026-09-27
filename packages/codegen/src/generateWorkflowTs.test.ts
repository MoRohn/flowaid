import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  WorkflowDefinitionSchema,
  definitionHash,
  type Binding,
  type JsonValue,
} from "@flowaid/workflow-core";
import {
  CodegenRoundTripError,
  assertRoundTrip,
  evaluateWorkflowTs,
  generateWorkflowTs,
} from "./generateWorkflowTs.js";
import { FIXTURE_NAMES, fixture } from "./test/support.js";

describe("generateWorkflowTs", () => {
  it.each(FIXTURE_NAMES)("%s: matches its golden file and round-trips", async (name) => {
    const def = fixture(name);
    const source = await generateWorkflowTs(def);
    await expect(source).toMatchFileSnapshot(`../golden/${name.replace("/", "--")}.workflow.ts`);
    expect(assertRoundTrip(def, source)).toBe(definitionHash(def));
    // Layout and metadata are outside the hash; the module keeps them anyway.
    const back = WorkflowDefinitionSchema.parse(evaluateWorkflowTs(source));
    const parsed = WorkflowDefinitionSchema.parse(def);
    expect(back.layout).toEqual(parsed.layout);
    expect(back.metadata).toEqual(parsed.metadata);
  });

  it("imports only the builders it uses, from @flowaid/workflow-sdk", async () => {
    const source = await generateWorkflowTs(fixture("example-support-reply"));
    const imports = /import \{([^}]*)\} from "@flowaid\/workflow-sdk"/.exec(source)?.[1] ?? "";
    const names = imports
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    for (const n of names)
      expect(source.split(`${n}(`).length + source.split(`${n}.`).length).toBeGreaterThan(2);
    expect(names).not.toContain("loop");
  });

  it("fails with CODEGEN_ROUNDTRIP when the module does not reproduce the definition", async () => {
    const def = fixture("example-support-reply");
    const source = await generateWorkflowTs(def);
    const tampered = source.replace('"Which team should handle', '"Which queue should handle');
    expect(() => assertRoundTrip(def, tampered)).toThrow(CodegenRoundTripError);
    expect(() => assertRoundTrip(def, "export default 1;")).toThrow(CodegenRoundTripError);
    try {
      assertRoundTrip(def, tampered);
    } catch (error) {
      expect((error as CodegenRoundTripError).toInfo()).toMatchObject({
        code: "INTERNAL",
        details: { reason: "CODEGEN_ROUNDTRIP" },
      });
    }
  });

  it("emits strings as data, never as code (quotes, newlines, line separators, template syntax)", async () => {
    const def = WorkflowDefinitionSchema.parse(fixture("example-support-reply"));
    const tricky = {
      ...def,
      description: 'He said "hi"\n\u2028`${process.exit()}` */ //',
      metadata: { "a-b": 1, "": 2, "x y": { constructor: 3 } } as Record<string, JsonValue>,
    };
    const source = await generateWorkflowTs(tricky);
    const back = evaluateWorkflowTs(source) as { description: string; metadata: object };
    expect(back.description).toBe(tricky.description);
    expect(back.metadata).toEqual(tricky.metadata);
    expect(definitionHash(back)).toBe(definitionHash(tricky));
  });
});

// ─────────────── property: random valid definitions over every node and binding kind ───────────────

const nodeId = fc.stringMatching(/^[a-z][a-z0-9_]{0,12}$/);
const port = fc.stringMatching(/^[a-z][a-z0-9_]{0,8}$/);
const text = fc.string({ maxLength: 40 });
const exprSource = fc.string({ minLength: 1, maxLength: 30 });
const pointer = fc.constantFrom("/a", "/a/0", "/x~1y", "");
const json = fc.jsonValue({ maxDepth: 2 }) as fc.Arbitrary<JsonValue>;

const binding: fc.Arbitrary<Binding> = fc.letrec<{ b: Binding }>((tie) => ({
  b: fc.oneof(
    { depthSize: "small", withCrossShrink: true },
    json.map((value): Binding => ({ kind: "literal", value })),
    fc
      .record(
        {
          node: nodeId,
          port,
          path: fc.option(pointer, { nil: undefined }),
          default: fc.option(json, { nil: undefined }),
        },
        { requiredKeys: ["node", "port"] },
      )
      .map(({ node, port: p, path, default: d }): Binding => ({
        kind: "ref",
        ref:
          path === undefined
            ? { kind: "port", node, port: p }
            : { kind: "port", node, port: p, path },
        ...(d === undefined ? {} : { default: d }),
      })),
    fc.constantFrom<Binding>(
      { kind: "ref", ref: { kind: "var", name: "threshold" } },
      { kind: "ref", ref: { kind: "scope", field: "item", path: "/title" } },
      { kind: "ref", ref: { kind: "run", field: "id" } },
      { kind: "ref", ref: { kind: "scope", field: "carry" }, default: 0 },
    ),
    text.map((source): Binding => ({ kind: "template", source })),
    exprSource.map((source): Binding => ({ kind: "expr", source })),
    fc
      .dictionary(fc.string({ maxLength: 8 }), tie("b"), { maxKeys: 3 })
      .map((fields): Binding => ({ kind: "object", fields })),
    fc.array(tie("b"), { maxLength: 3 }).map((items): Binding => ({ kind: "array", items })),
  ),
})).b;

const bindings = fc.dictionary(port, binding, { maxKeys: 3 });
const bounds = fc.record({ maxIterations: fc.integer({ min: 1, max: 50 }) });
const common = fc.record(
  {
    name: fc.string({ minLength: 1, maxLength: 20 }),
    description: text,
    parent: nodeId,
    disabled: fc.boolean(),
    policy: fc.constantFrom(
      { onError: "route" },
      { timeoutMs: 1000, retry: { maxAttempts: 3 } },
      { privacy: { sensitive: true } },
    ),
  },
  { requiredKeys: ["name"] },
);

const node = fc.oneof(
  common.map((c) => ({ ...c, kind: "input" })),
  fc
    .record({
      c: common,
      value: binding,
      outcome: fc.option(fc.string({ maxLength: 10 }), { nil: undefined }),
      earlyExit: fc.boolean(),
    })
    .map(({ c, ...r }) => ({ ...c, kind: "output", ...r })),
  fc
    .record({
      c: common,
      type: fc.constantFrom(
        "flowaid.decision.choice",
        "flowaid.tools.http",
        "@community/slack.post",
      ),
      typeVersion: fc.constantFrom("1.0.0", "2.3.1"),
      config: fc.dictionary(fc.string({ maxLength: 6 }), json, { maxKeys: 3 }),
      inputs: bindings,
      credentials: fc.dictionary(port, fc.constantFrom("OPENAI_API_KEY", "CRM_TOKEN"), {
        maxKeys: 2,
      }),
    })
    .map(({ c, ...r }) => ({ ...c, kind: "task", ...r })),
  fc
    .record({
      c: common,
      mode: fc.constantFrom("first", "all"),
      cases: fc.array(fc.record({ port, when: exprSource }), { minLength: 1, maxLength: 3 }),
      defaultPort: fc.constantFrom("default", "other"),
    })
    .map(({ c, ...r }) => ({ ...c, kind: "branch", ...r })),
  fc
    .record({
      c: common,
      mode: fc.constantFrom({ type: "all" }, { type: "race" }, { type: "count", n: 2 }),
      inputs: bindings,
    })
    .map(({ c, ...r }) => ({ ...c, kind: "join", ...r })),
  fc
    .record({
      c: common,
      next: bindings,
      result: bindings,
      bounds,
      onExhausted: fc.constantFrom("route", "fail"),
    })
    .map(({ c, next, ...r }) => ({
      ...c,
      kind: "loop",
      carrySchema: { type: "object" },
      carry: { initial: { n: 0 }, next },
      ...r,
    })),
  fc
    .record({
      c: common,
      items: binding,
      collect: fc.option(binding, { nil: undefined }),
      concurrency: fc.integer({ min: 1, max: 8 }),
      bounds,
    })
    .map(({ c, ...r }) => ({
      ...c,
      kind: "foreach",
      ...r,
      ...(r.collect === undefined ? { collect: undefined } : {}),
      reduce: { initial: 0, expr: "$acc + 1" },
    })),
  fc.record({ c: common, inputs: bindings, pinned: fc.boolean() }).map(({ c, inputs, pinned }) => ({
    ...c,
    kind: "subflow",
    workflowId: "01900000-0000-7000-8000-00000000000a",
    ...(pinned ? { version: { versionId: "01900000-0000-7000-8000-00000000000b" } } : {}),
    inputs,
  })),
  fc.record({ c: common, at: binding, delay: fc.boolean() }).map(({ c, at, delay }) => ({
    ...c,
    kind: "wait",
    until: delay ? { type: "delay", ms: 1000 } : { type: "timestamp", at },
  })),
  fc
    .record({ c: common, title: binding, context: bindings, value: binding, review: fc.boolean() })
    .map(({ c, title, context, value, review }) => ({
      ...c,
      kind: "human",
      mode: review ? { type: "review", value, schema: { type: "object" } } : { type: "approval" },
      title,
      context,
      assignees: ["role:admin"],
      onExpire: "route",
      externalReview: true,
    })),
  fc.record({ c: common, text }).map(({ c, text: t }) => ({ ...c, kind: "note", text: t })),
);

const definition = fc
  .record({
    name: fc.string({ minLength: 1, maxLength: 30 }),
    description: text,
    nodes: fc.uniqueArray(fc.tuple(nodeId, node), {
      minLength: 2,
      maxLength: 6,
      selector: ([id]) => id,
    }),
    edges: fc.uniqueArray(
      fc.record({
        id: fc.stringMatching(/^[a-z0-9][a-z0-9_-]{0,8}$/),
        a: nodeId,
        p: port,
        b: nodeId,
      }),
      {
        maxLength: 4,
        selector: (e) => e.id,
      },
    ),
    triggers: fc.subarray([
      { type: "manual" },
      { type: "webhook", path: "hook-1" },
      { type: "schedule", cron: "0 * * * * *" },
      { type: "mcp", toolName: "run_it", description: "Runs it" },
      { type: "event", eventName: "order.created" },
    ]),
    metadata: fc.dictionary(fc.string({ maxLength: 6 }), json, { maxKeys: 2 }),
    withLayout: fc.boolean(),
  })
  .map((r) => ({
    $schema: "https://flowaid.dev/schemas/workflow/v1",
    id: "01900000-0000-7000-8000-000000000001",
    name: r.name,
    description: r.description,
    inputs: { type: "object", properties: { message: { type: "string" } } },
    outputs: { type: "object" },
    nodes: r.nodes.map(([id, n]) => ({ id, ...n })),
    edges: r.edges.map((e) => ({ id: e.id, from: { node: e.a, port: e.p }, to: { node: e.b } })),
    variables: [
      { name: "threshold", schema: { type: "number" }, default: 0.8, source: "environment" },
    ],
    secrets: [{ name: "OPENAI_API_KEY", credentialType: "openai.api_key", required: false }],
    triggers: r.triggers,
    execution: { timeoutMs: 60_000, decisions: { failover: [{ provider: "rule" }] } },
    ...(r.withLayout ? { layout: { nodes: { [r.nodes[0]?.[0] ?? "a"]: { x: 1, y: 2 } } } } : {}),
    metadata: r.metadata,
  }))
  .filter((d) => WorkflowDefinitionSchema.safeParse(d).success);

describe("generateWorkflowTs (property)", () => {
  it("is total: every valid definition round-trips to the same definitionHash", async () => {
    await fc.assert(
      fc.asyncProperty(definition, async (def) => {
        const source = await generateWorkflowTs(def, { raw: true });
        expect(definitionHash(evaluateWorkflowTs(source))).toBe(definitionHash(def));
      }),
      { numRuns: 150 },
    );
  });

  it("formats with Prettier without changing the result", async () => {
    await fc.assert(
      fc.asyncProperty(definition, async (def) => {
        const source = await generateWorkflowTs(def);
        expect(assertRoundTrip(def, source)).toBe(definitionHash(def));
      }),
      { numRuns: 25 },
    );
  });
});
