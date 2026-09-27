# @flowaid/workflow-sdk

Build FlowAId workflows as typed code (API.md §8.1). Exported code packages use it for
`src/workflow.ts`.

```ts
import { defineWorkflow, input, output, ref, task, tpl } from "@flowaid/workflow-sdk";

export const workflow = defineWorkflow({
  id: "01900000-0000-7000-8000-000000000001",
  name: "Greeter",
  inputs: { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
  outputs: { type: "object" },
  nodes: {
    start: input("Start"),
    greet: task("flowaid.data.template", {
      typeVersion: "1.0.0",
      name: "Greet",
      config: { template: "Hello {{ start.name }}" },
    }),
    done: output("Done", { value: ref("greet", "text") }),
  },
});
```

The builder set is fixed and total over `WorkflowDefinitionSchema`:

- nodes: `input`, `output`, `task`, `branch`, `join`, `loop`, `foreach`, `subflow`, `wait`,
  `human`, `note`;
- bindings: `ref`, `ref.var`, `ref.scope`, `ref.run` (each with `.default(value)`), `lit`, `tpl`,
  `expr`, `obj`, `arr`;
- document parts: `edge`, `secret`, `variable`, `trigger.*`, `defineWorkflow`.

Every builder returns the contract JSON unchanged, so
`definitionHash(defineWorkflow(...)) === definitionHash(json)`. `@flowaid/codegen` relies on this
for its round-trip check. The builders are also exported on their own as
`@flowaid/workflow-sdk/builders`. The HTTP client and the streaming transport (§8.2) will join
the main entry point.
