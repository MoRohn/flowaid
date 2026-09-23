# @flowaid/node-sdk

Write flowaid nodes. A node is one object: Zod schemas for its config, inputs and outputs,
metadata, the capabilities it needs, how idempotent it is, and `execute(ctx, input)`. The SDK
turns it into the JSON manifest the compiler, the API and the browser read, and gives the node a
context that exposes only the services it declared. Design:
[ARCHITECTURE.md §3](../../docs/design/ARCHITECTURE.md) and `CONTRACTS.ts` §16.

## A node

```ts
import { z } from "zod";
import { defineNode, ok } from "@flowaid/node-sdk";

export const lookup = defineNode({
  id: "@acme/crm.lookup",
  version: "1.0.0",
  metadata: {
    name: "Customer lookup",
    description: "Finds a customer by email",
    category: "tool",
    icon: "search",
    tags: ["crm"],
  },
  configSchema: z.strictObject({ region: z.enum(["eu", "us"]).default("eu") }),
  inputSchema: z.object({
    email: z.string().meta({ "x-dataClass": "pii", "x-port": { description: "Customer email" } }),
  }),
  outputSchema: z.object({ customer: z.object({ id: z.string(), tier: z.int() }) }),
  credentials: [{ name: "crm", types: ["http.bearer"], required: true }],
  capabilities: ["network", "credentials"],
  idempotency: "safe",
  async execute(ctx, input) {
    const { token } = await ctx.credentials.get("crm");
    const res = await ctx.http(
      `https://${ctx.config.region}.crm.example.com/customers?email=${encodeURIComponent(input.email)}`,
      {
        headers: { authorization: `Bearer ${token}` },
        signal: ctx.signal,
      },
    );
    return ok({ customer: (await res.json()) as { id: string; tier: number } });
  },
});
```

- The runtime validates `input` before `execute` and `output` after it; a node never sees
  malformed input and cannot emit malformed output.
- Services of undeclared capabilities throw `ForbiddenError` (`ctx.http` needs `network`,
  `ctx.credentials` needs `credentials`, and so on).
- Return `ok(output, { route })` to fire a declared control port instead of `done`,
  `suspend(wait, state)` to wait durably for a person or an event (needs `suspend`; `execute`
  runs again with `ctx.resume`), or `fail(error)`. A throw is the same as `fail`.

## Manifests

`toManifest(def)` builds the `NodeManifest` with `z.toJSONSchema` (draft 2020-12). Hints ride on
`.meta()`: `x-ui` (inspector widgets), `x-dataClass` (write-time redaction), `x-secret`
(credential fields), `x-port: { description }` (describes the port itself), and `x-jsonSchema`
(a verbatim schema for shapes Zod cannot express). Defaulted config fields are optional in the
manifest; `.optional()` input and output properties are optional ports.

## Packages

`definePackage({ name, version, nodes, credentialTypes, providers, sdk })`. The plugin loader
(`normalizePackage`) also accepts a module that exports a single `node` or a `nodes` array.
Third-party node ids start with the package name (`@acme/crm` owns `@acme/crm.*`); `flowaid.*`
is reserved for `@flowaid/*` packages.

## Testing

```ts
import { runNode } from "@flowaid/node-sdk/testing";

const { result, recorder } = await runNode(lookup, {
  config: { region: "eu" },
  input: { email: "ada@example.com" },
  credentials: { crm: { token: "t" } },
  http: async () => new Response(JSON.stringify({ id: "c1", tier: 2 })),
});
```

`runNode` validates exactly like the runtime. `createTestContext` gives in-memory credentials,
state, artifacts and tools, injectable fake providers and a mock `http`, and records every
event, stream delta, log line, tool call and credential read.
