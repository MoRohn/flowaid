import { readdirSync, readFileSync } from "node:fs";
import { dirname, join as joinPath } from "node:path";
import { fileURLToPath } from "node:url";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  WorkflowDefinitionSchema,
  definitionHash,
  type Binding,
  type JsonValue,
} from "@flowaid/workflow-core";
import { rebuild } from "../test/rebuild.js";
import {
  branch,
  defineWorkflow,
  edge,
  input,
  lit,
  obj,
  output,
  ref,
  secret,
  task,
  tpl,
  trigger,
  variable,
  type WorkflowDefinitionInput,
} from "./index.js";

const FIXTURES = joinPath(
  dirname(fileURLToPath(import.meta.url)),
  "../../../workflow-core/fixtures",
);
const fixtures = readdirSync(FIXTURES)
  .filter((f) => f.endsWith(".json"))
  .sort()
  .map(
    (f) =>
      [
        f,
        JSON.parse(readFileSync(joinPath(FIXTURES, f), "utf8")) as WorkflowDefinitionInput,
      ] as const,
  );

describe("builders round-trip the fixture definitions", () => {
  it("covers the four first-slice fixtures", () => {
    expect(fixtures.map(([f]) => f)).toEqual([
      "example-support-reply.json",
      "github-issue-triage.json",
      "research-agent.json",
      "support-triage.json",
    ]);
  });

  it.each(fixtures)("%s: same JSON, same definitionHash", (_file, raw) => {
    const built = rebuild(raw);
    expect(built).toEqual(raw);
    expect(definitionHash(built)).toBe(definitionHash(raw));
    expect(JSON.parse(JSON.stringify(built))).toEqual(raw);
  });
});

describe("builder surface", () => {
  it("builds the API.md §8 example into a schema-valid definition", () => {
    const def = defineWorkflow({
      id: "0190b5a4-0000-7000-8000-0000000000aa",
      name: "Support intake",
      inputs: {
        type: "object",
        properties: { message: { type: "string" } },
        required: ["message"],
      },
      outputs: { type: "object", properties: { queue: { type: "string" } } },
      nodes: {
        start: input("Start"),
        intent: task("flowaid.decision.choice", {
          name: "Intent",
          typeVersion: "1.0.0",
          config: { options: ["billing", "tech"] },
          inputs: { state: obj({ message: ref("start", "message") }) },
          credentials: { llm: "TYPESAFE_API_KEY" },
        }),
        route: branch("Route", {
          cases: [{ port: "billing", when: "intent.decision.value == 'billing'" }],
          defaultPort: "other",
        }),
        done: output("Done", { value: obj({ queue: ref("intent", "decision", "/value") }) }),
      },
      edges: [
        edge({ node: "start", port: "done" }, "intent"),
        edge({ node: "intent", port: "done" }, "route"),
        edge({ node: "route", port: "billing" }, "done", "c1"),
      ],
      secrets: [secret("TYPESAFE_API_KEY", "typesafe.api_key")],
      variables: [variable("threshold", { type: "number" }, { default: 0.8 })],
      triggers: [trigger.manual(), trigger.event({ eventName: "ticket.created" })],
    });
    expect(WorkflowDefinitionSchema.safeParse(def).success).toBe(true);
    expect(def.nodes.map((n) => n.id)).toEqual(["start", "intent", "route", "done"]);
    expect(def.edges?.map((e) => e.id)).toEqual(["start-done-intent", "intent-done-route", "c1"]);
    expect(def.nodes[1]).toEqual({
      id: "intent",
      kind: "task",
      type: "flowaid.decision.choice",
      name: "Intent",
      typeVersion: "1.0.0",
      config: { options: ["billing", "tech"] },
      inputs: {
        state: {
          kind: "object",
          fields: {
            message: { kind: "ref", ref: { kind: "port", node: "start", port: "message" } },
          },
        },
      },
      credentials: { llm: "TYPESAFE_API_KEY" },
    });
  });

  it("ref(...).default(v) is the optional ref, and the method never reaches the JSON", () => {
    const r = ref("lookup", "account");
    expect(Object.keys(r)).toEqual(["kind", "ref"]);
    expect(JSON.stringify(r)).toBe(
      '{"kind":"ref","ref":{"kind":"port","node":"lookup","port":"account"}}',
    );
    expect(r.default(null)).toEqual({
      kind: "ref",
      ref: { kind: "port", node: "lookup", port: "account" },
      default: null,
    });
    expect(ref.var("threshold")).toEqual({ kind: "ref", ref: { kind: "var", name: "threshold" } });
    expect(ref.scope("item", "/title")).toEqual({
      kind: "ref",
      ref: { kind: "scope", field: "item", path: "/title" },
    });
    expect(ref.run("id").default("x")).toEqual({
      kind: "ref",
      ref: { kind: "run", field: "id" },
      default: "x",
    });
    expect(tpl("Hi {{ start.name }}")).toEqual({ kind: "template", source: "Hi {{ start.name }}" });
    expect(lit([1, "a"])).toEqual({ kind: "literal", value: [1, "a"] });
  });

  it("rejects conflicting and missing node ids", () => {
    const base = {
      id: "0190b5a4-0000-7000-8000-0000000000aa",
      name: "x",
      inputs: { type: "object" as const },
      outputs: { type: "object" as const },
    };
    expect(() => defineWorkflow({ ...base, nodes: { a: input("A", { id: "b" }) } })).toThrow(
      /different id/,
    );
    expect(() => defineWorkflow({ ...base, nodes: [input("A") as never] })).toThrow(/needs an id/);
  });
});

// --- property: builders are the identity over generated definitions ---

const nodeId = fc.stringMatching(/^[a-z][a-z0-9_]{0,10}$/);
const port = fc.stringMatching(/^[a-z][a-z0-9_]{0,8}$/);
const pointer = fc
  .array(fc.stringMatching(/^[a-z0-9]{1,4}$/), { maxLength: 3 })
  .map((p) => p.map((s) => `/${s}`).join(""));
const json: fc.Arbitrary<JsonValue> = fc.jsonValue({ maxDepth: 2 }) as fc.Arbitrary<JsonValue>;

const binding: fc.Arbitrary<Binding> = fc.letrec<{ b: Binding }>((tie) => ({
  b: fc.oneof(
    { depthSize: "small", withCrossShrink: true },
    json.map((value): Binding => ({ kind: "literal", value })),
    fc.string({ maxLength: 20 }).map((source): Binding => ({ kind: "template", source })),
    fc.string({ minLength: 1, maxLength: 20 }).map((source): Binding => ({ kind: "expr", source })),
    fc
      .record(
        { node: nodeId, port, path: fc.option(pointer, { nil: undefined }) },
        { requiredKeys: ["node", "port"] },
      )
      .map((r): Binding => ({ kind: "ref", ref: { kind: "port", ...r } })),
    fc
      .tuple(fc.stringMatching(/^[a-z][a-zA-Z0-9_]{0,8}$/), json)
      .map(([name, d]): Binding => ({ kind: "ref", ref: { kind: "var", name }, default: d })),
    fc
      .constantFrom("item", "index", "iteration", "carry")
      .map((field): Binding => ({ kind: "ref", ref: { kind: "scope", field } })),
    fc
      .constantFrom("id", "workflowId", "environment", "sessionId")
      .map((field): Binding => ({ kind: "ref", ref: { kind: "run", field } })),
    fc
      .dictionary(port, tie("b"), { maxKeys: 3 })
      .map((fields): Binding => ({ kind: "object", fields })),
    fc.array(tie("b"), { maxLength: 3 }).map((items): Binding => ({ kind: "array", items })),
  ),
})).b;

const definition = fc
  .record({
    ids: fc.uniqueArray(nodeId, { minLength: 1, maxLength: 5 }),
    tasks: fc.array(
      fc.record({
        type: fc.constantFrom("flowaid.ai.generate", "flowaid.tools.http", "@acme/crm.lookup"),
        inputs: fc.dictionary(port, binding, { maxKeys: 3 }),
        config: fc.dictionary(port, json, { maxKeys: 2 }),
      }),
      { minLength: 5, maxLength: 5 },
    ),
    value: binding,
    triggers: fc.subarray([
      { type: "manual" as const },
      { type: "event" as const, eventName: "order.paid" },
      { type: "schedule" as const, cron: "0 9 * * 1-5", timezone: "UTC" },
      { type: "webhook" as const, path: "orders-in", signature: "token" as const },
    ]),
  })
  .map(({ ids, tasks, value, triggers }): WorkflowDefinitionInput => {
    const taskIds = ids.filter((i) => i !== "start" && i !== "done");
    return {
      $schema: "https://flowaid.dev/schemas/workflow/v1",
      id: "0190b5a4-0000-7000-8000-0000000000bb",
      name: "Generated",
      inputs: { type: "object" },
      outputs: {},
      nodes: [
        { id: "start", kind: "input", name: "Start" },
        ...taskIds.map((id, i) => ({
          id,
          kind: "task" as const,
          name: id,
          type: tasks[i]?.type ?? "flowaid.ai.generate",
          typeVersion: "1.0.0",
          config: tasks[i]?.config ?? {},
          inputs: tasks[i]?.inputs ?? {},
        })),
        { id: "done", kind: "output", name: "Done", value },
      ],
      edges: taskIds.map((id, i) => ({
        id: `c${i}`,
        from: { node: i === 0 ? "start" : (taskIds[i - 1] as string), port: "done" },
        to: { node: id },
      })),
      triggers,
    };
  });

describe("property", () => {
  it("rebuilding any generated definition yields the same JSON and hash", () => {
    fc.assert(
      fc.property(definition, (def) => {
        const built = rebuild(def);
        expect(built).toEqual(def);
        expect(definitionHash(built)).toBe(definitionHash(def));
      }),
      { numRuns: 150 },
    );
  });
});
