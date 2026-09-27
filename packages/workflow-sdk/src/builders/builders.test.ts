import { describe, expect, it } from "vitest";
import { WorkflowDefinitionSchema, definitionHash } from "@flowaid/workflow-core";
import {
  arr,
  defineWorkflow,
  edge,
  expr,
  input,
  lit,
  obj,
  output,
  ref,
  secret,
  task,
  tpl,
} from "./index.js";

const ID = "01900000-0000-7000-8000-000000000001";

describe("builders", () => {
  it("emit the contract JSON unchanged, so the hash equals the hand-written document's", () => {
    const built = defineWorkflow({
      id: ID,
      name: "Greeter",
      inputs: { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
      outputs: { type: "object" },
      secrets: [secret("OPENAI_API_KEY", "openai.api_key")],
      nodes: {
        start: input("Start"),
        greet: task("flowaid.data.template", {
          typeVersion: "1.0.0",
          name: "Greet",
          config: { template: "Hi" },
          inputs: {
            data: obj({ name: ref("start", "name"), all: arr([lit(1), expr("1 + 1")]) }),
            missing: ref("start", "name", "/x").default("none"),
            text: tpl("Hello {{ start.name }}"),
          },
        }),
        done: output("Done", { value: ref("greet", "text") }),
      },
      edges: [edge({ node: "greet", port: "done" }, "done", "e1")],
    });
    const json = {
      $schema: "https://flowaid.dev/schemas/workflow/v1",
      id: ID,
      name: "Greeter",
      inputs: { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
      outputs: { type: "object" },
      secrets: [{ name: "OPENAI_API_KEY", credentialType: "openai.api_key" }],
      nodes: [
        { id: "start", kind: "input", name: "Start" },
        {
          id: "greet",
          kind: "task",
          type: "flowaid.data.template",
          typeVersion: "1.0.0",
          name: "Greet",
          config: { template: "Hi" },
          inputs: {
            data: {
              kind: "object",
              fields: {
                name: { kind: "ref", ref: { kind: "port", node: "start", port: "name" } },
                all: {
                  kind: "array",
                  items: [
                    { kind: "literal", value: 1 },
                    { kind: "expr", source: "1 + 1" },
                  ],
                },
              },
            },
            missing: {
              kind: "ref",
              ref: { kind: "port", node: "start", port: "name", path: "/x" },
              default: "none",
            },
            text: { kind: "template", source: "Hello {{ start.name }}" },
          },
        },
        {
          id: "done",
          kind: "output",
          name: "Done",
          value: { kind: "ref", ref: { kind: "port", node: "greet", port: "text" } },
        },
      ],
      edges: [{ id: "e1", from: { node: "greet", port: "done" }, to: { node: "done" } }],
    };
    expect(built).toEqual(json);
    expect(() => WorkflowDefinitionSchema.parse(built)).not.toThrow();
    expect(definitionHash(built)).toBe(definitionHash(json));
  });

  it("keeps the .default() helper out of the document", () => {
    const r = ref.var("threshold");
    expect(JSON.parse(JSON.stringify(r))).toEqual({
      kind: "ref",
      ref: { kind: "var", name: "threshold" },
    });
    expect(r.default(0.5)).toEqual({
      kind: "ref",
      ref: { kind: "var", name: "threshold" },
      default: 0.5,
    });
  });
});
