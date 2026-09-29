# Calling workflows

Every published workflow is an HTTP endpoint, an SDK call, a CLI command and an MCP tool, and it
can be started by webhooks, schedules and events. Draft runs from the builder need none of this;
publish and deploy a version first (_Publish_ in the builder).

## REST API

Create an API key under _Settings → API keys_ (pin it to an environment), then:

```sh
curl -X POST http://flowaid.localhost:3001/v1/workflows/<workflow-id>/run \
  -H "Authorization: Bearer fa_live_…" -H "Content-Type: application/json" \
  -d '{"input": {"message": "I was charged twice for order 1182"}, "mode": "sync"}'
```

A run that finishes answers `200` with its output, cost and usage; one that waits for a person
answers `202` with the human task.

## TypeScript SDK

With `@flowaid/workflow-sdk`:

```ts
import { Flowaid } from "@flowaid/workflow-sdk";

const fa = new Flowaid({
  baseUrl: "http://flowaid.localhost:3001",
  apiKey: process.env.FLOWAID_API_KEY,
});
const run = await fa.workflows.run(workflowId, { message: "Refund please" });
for await (const event of run.stream()) {
  if (event.type === "DECISION_COMPLETED") console.log(event.decision.confidence);
}
console.log(await run.output());
```

## Command line

With the `flowaid` CLI (`packages/cli`; every API operation is a command, and
`pnpm flowaid` runs it from a checkout):

```sh
pnpm flowaid login --api-url http://flowaid.localhost:3001 --api-key fa_live_…
pnpm flowaid workflow run <workflow-id> --input '{"message":"Refund please"}' --watch
pnpm flowaid workflow package <workflow-id> --version 1 --out refund-triage.zip   # runnable code
pnpm flowaid validate ./my-flow.json                                               # no server
```

## As MCP tools

Under _Integrations → Workflows as MCP tools_, expose a workflow and mint an
MCP token; any MCP client can then list and call it at `http://flowaid.localhost:3001/mcp/<workspace>`
(streamable HTTP, `Authorization: Bearer <token>`).

## Webhooks, schedules and events

Triggers in a workflow's definition become live URLs,
cron schedules and event subscriptions when a version is deployed to an environment.
