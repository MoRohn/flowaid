# RFC-0006: Event correlation for waits and event triggers

- Status: accepted 2026-09-27
- Raised by: `event-trigger-ingress`, `trigger-materialisation`
- Implemented by: P6-06
- Affects: `CONTRACTS.ts` §6 (`WaitNodeSchema.until.event.correlation`, `TriggerSchema.event.correlationKey`), §7 (`PlanOp` wait `until.event.correlation`), §10 (`NODE_WAITING.correlationKey`), §17 (`Job` `run.signal` event `correlationKey`); `@flowaid/workflow-core` 0.3.6 → 0.3.7

## Motivation

`POST /v1/events/:eventName` already accepted a `correlationKey`, and `event_subscriptions`
already had a `correlation_key` column, but nothing could set it: every waiting run subscribed
with `null` and every published event of that name resumed every waiting run. A workflow waiting
for "order A-1 paid" was resumed by "order B-2 paid".

## Change

Additive (optional fields only):

```ts
// §6 WaitNodeSchema.until, event member
correlation: BindingSchema.optional(), // evaluated when the node starts waiting
// §6 TriggerSchema, event member
correlationKey: JsonPointerSchema.optional(), // pointer into the payload → the started run's sessionId
// §7 PlanOp wait, event member
correlation: CompiledBindingSchema.optional(),
// §10 NODE_WAITING
correlationKey: z.string().max(200).optional(),
// §17 Job run.signal, event signal
correlationKey?: string;
```

Semantics:

- A wait whose `correlation` is set evaluates it when it starts waiting. The value must be a
  non-empty string, number or boolean (numbers and booleans compare as their text, at most 200
  characters); anything else fails the node. The compiler type-checks the binding against a
  scalar (`E_TYPE_MISMATCH`).
- `NODE_WAITING` carries the key; the `event_subscriptions` projection stores it.
- An event published with a key resumes waits with that key and waits without a key; an event
  published without a key resumes only waits without a key. The runtime applies the same rule,
  so a stale subscription row can never resume the wrong wait.
- An event trigger with `correlationKey` sets the started run's `sessionId` to the payload value
  at that pointer (falling back to the published key), so the runs one business object starts
  can be found together.

## Compatibility

- Stored data: nothing to migrate. Existing plans have no `correlation` and hash unchanged; the
  `event_subscriptions.correlation_key` column already exists and old rows are `null`.
- Wire: `POST /v1/events/:eventName` and `fa.events.emit(name, payload, correlationKey?)` are
  unchanged; generated SDK types are unchanged.
- Design docs: `API.md` already describes key matching; `DATABASE.md` unchanged.

## Tests

- `workflow-runtime` `constructs.test.ts`: two runs waiting on the same event with different keys
  each receive only their payload; an unkeyed event does not resume a correlated wait; a
  correlation that evaluates to nothing fails the wait.
- `workflow-compiler` `eventCorrelation.test.ts`: emitted into the plan; absent otherwise; a
  non-scalar correlation is `E_TYPE_MISMATCH`.
- `apps/api` `ingress.pg.test.ts`: delivery by key, unkeyed delivery, the trigger pointer setting
  the session, the key on the signal job.
- `apps/worker` `eventCorrelation.pg.test.ts`: the subscription row carries the key; a signal with
  another key leaves the run waiting; the matching one completes it.

## Alternatives considered

- Correlating by `sessionId` only: forces one session per business object and cannot express a
  wait keyed by a value computed mid-run.
- An expression over the payload on the wait (`when: payload.order == start.order`): needs every
  waiting run to be loaded and evaluated per event instead of an indexed lookup.
