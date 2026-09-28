# @flowaid/workflow-sdk

The TypeScript client of the FlowAId API and the workflow builders (`docs/design/API.md` §8).
Isomorphic: it uses `fetch` and web streams only, so it runs on Node 24 and in browsers.

```ts
import { Flowaid } from "@flowaid/workflow-sdk";

const fa = new Flowaid({ baseUrl: "http://localhost:3001", apiKey: process.env.FLOWAID_API_KEY });
const run = await fa.workflows.run(workflowId, { message: "hi" }, { environmentId });
for await (const ev of run.stream()) {
  if (ev.type === "DECISION_COMPLETED") console.log(ev.decision.confidence); // typed by RunEventSchema
}
const done = await run.wait();
```

## Client

- `fa.workflows`: `list`, `get`, `create`, `import`, `saveDraft`, `publish`, `versions`,
  `deploy`, `deployments`, `run`, `runs.list`, `runs.stream` (status changes of a workflow's
  runs), `exportPackage(id, { version: n | "draft", mode })` → zip bytes.
- `fa.versions.run`, `fa.runs` (`get`, `list`, `cancel`, `stream`), `fa.humanTasks`
  (`list`, `get`, `respond`), `fa.events.emit(name, payload, correlationKey?)`,
  `fa.evaluations` (`start`, `runs.get`, `runs.stream`).
- `fa.api.get|post|put|patch|delete(path, { path, query, body })` reaches every operation with
  types generated from the API's OpenAPI document (`src/generated/openapi.ts`).
- Failures throw `FlowaidApiError` with the error envelope's `code`, `status`, `details`,
  `requestId`, `runId` and `nodeId`.

Auth is an API key (`Authorization: Bearer`) or, in the browser, the session cookie
(`cookies: true`); every request carries `X-Requested-With: flowaid` and, when set,
`X-Workspace`.

## Run handles and streaming

`RunHandle.stream({ types, deltas, logs, until, after, signal })` reads
`GET /v1/runs/:id/stream` over `fetch` + `eventsource-parser`. It never uses the browser
`EventSource`, which cannot send `Authorization`. After a dropped connection it resumes with
`Last-Event-ID`, so durable events arrive once and in order. It backs off with full jitter
from 1 s to 30 s and gives up after 5 consecutive failures (`StreamDisconnectedError`). A
resume position the server no longer holds raises `StreamExpiredError`: re-read the run
instead. `run.text(nodeId)` yields a node's streamed text and trims characters repeated after
a reconnect. `run.wait()` resolves with the run once it ends. The handle also has
`run.output()`, `run.events()` and `run.cancel()`.

## Builders

`defineWorkflow, input, output, task, branch, join, loop, foreach, subflow, wait, human, note,
edge, ref (+ ref.var, ref.scope, ref.run, .default), lit, tpl, expr, obj, arr, secret, variable,
trigger.*` are also available from `@flowaid/workflow-sdk/builders`. Each builder returns the
`CONTRACTS.ts` JSON with exactly the keys you pass, so
`definitionHash(defineWorkflow(...))` equals the hash of the same definition written as JSON.
The tests check this on the golden fixtures and with a fast-check property.

## Regenerating the types

`pnpm sdk:types` rebuilds `openapi.json`, `src/generated/openapi.ts` and the CLI's operation
table from the API. `pnpm sdk:check`, which is part of `pnpm check`, fails when any of them is
stale.
