# Ask FlowAId: the workspace assistant

Ask FlowAId answers questions about a workspace:

- what failed and why;
- what got slower or more expensive;
- what is waiting for approval;
- how a workflow is doing.

It reads through six tools, can change nothing, and every answer cites the records it rests on.
How it is measured is in [FLOWAID_AI_EVALUATION.md](../FLOWAID_AI_EVALUATION.md).

## Request flow

1. The web panel, or any client with `runs:read`, sends `POST /v1/assistant/ask
{ question, history? }`. `history` holds up to 12 earlier turns; the loop keeps the last 6.
2. The API resolves the workspace's generation model the same way as the AI builder:
   - the workspace setting `advisorModel`, otherwise
   - the first of Anthropic `claude-sonnet-5`, OpenAI `gpt-5.5` or Ollama `qwen3:8b` that has a
     credential.

   With no model it answers 409, and `features.assistant` is false.

3. `ask()` (`packages/advisor/src/assistant.ts`) sends the system prompt, history and question
   with the tool definitions plus `final_answer` at temperature 0.
4. Each tool call runs in `apps/api/src/services/assistant.ts` inside the caller's tenant
   transaction:
   - Arguments are validated with Zod.
   - Results go back to the model between `<<<UNTRUSTED …>>>` markers, capped in size.
   - Errors reach the model only as messages written for it. Database errors become
     "<tool> failed".
5. The model finishes with `final_answer`: 1 to 20 statements, each with a kind and source ids.
6. `ask()` validates the statements. A source id must have been returned by a tool in this
   conversation. A fact or calculation left with no valid source becomes `uncertain` and is
   flagged `unverified`.
7. The response includes:
   - the statements;
   - the cited sources (id, kind, label, workflow);
   - the tool calls and whether they succeeded;
   - rounds, stop reason, usage, cost, prompt hash and model.

## Tools

| tool                  | returns                                                                                                       | never returns          |
| --------------------- | ------------------------------------------------------------------------------------------------------------- | ---------------------- |
| `list_workflows`      | id, name, description, latest version, last update, archived                                                  | definitions            |
| `list_runs`           | id, workflow, status, origin, time, duration, cost, error code and message (truncated)                        | inputs, outputs        |
| `get_run`             | status, version, timing, cost, usage, error, nodes that failed or retried with their errors, the trace review | node inputs or outputs |
| `get_metrics`         | the dashboard's production-traffic metrics for 24h, 7d or 30d                                                 | —                      |
| `get_insights`        | `GET /v1/insights`: regressions with evidence, open approvals, failing workflows                              | —                      |
| `list_open_approvals` | open human tasks: workflow, title, created, expires                                                           | request payloads       |

**Visibility.** The tools run under row-level security for the workspace:

- An API key pinned to workflows sees only those workflows.
- A key pinned to an environment sees only runs in that environment.
- A run the caller cannot see answers "not found", exactly as the API does.

## Grounding and trust

- **Statement kinds.** Every statement is labelled in the panel: _Fact_ (read from a tool),
  _Calculation_ (derived from tool results), _Suggestion_ (something to do) or _Unconfirmed_
  (a guess, or a claim with no source). Answers are never presented as certain beyond what they
  cite.
- **Citations are links.** Runs, workflows and approvals open in the app; insights and metrics
  open the Overview.
- **Provenance.** Each answer names the model and shows the number of lookups, the tokens and the
  cost, and whether a limit stopped it.
- **No reasoning dump.** The answer contains conclusions and their sources, not the model's hidden
  reasoning.

## Guardrails

| guardrail         | how                                                                                                                                                                                                   |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| authorization     | Scope `runs:read`. The tools use tenant transactions and principal pins. The assistant never gets a wider view than the caller.                                                                       |
| no side effects   | Only read-only tools exist. The prompt says so, and recommending an action means naming where to do it in FlowAId.                                                                                    |
| prompt injection  | Tool output is wrapped and delimiter lookalikes are broken up. The prompt treats it as data. An unknown tool name gets an error, not an action. The injection case in the evaluation set checks this. |
| data minimisation | No node inputs or outputs, and error messages are truncated. The audit stores metadata only, not the question.                                                                                        |
| cost and abuse    | At most 6 tool rounds and $0.25 per question, then the answer is forced. 20 questions a minute per caller, 2,000-character questions.                                                                 |
| output validation | `final_answer` is parsed with Zod. A malformed answer becomes one unconfirmed statement saying no answer could be formed.                                                                             |

## Model strategy

The assistant uses the same resolution as the AI builder. Changing the model is a workspace
setting and needs no code change, because the provider registry abstracts Anthropic,
OpenAI-compatible and Ollama models.

V2 deliberately has no routing between models: one model per workspace keeps behaviour
predictable and measurable. Before trying routing, run `pnpm eval:assistant` for each candidate
and compare the reports.

## Observability

Each question writes an audit event `assistant.ask` with:

- `model`, `tools`, `rounds` and `stopped`;
- `costUsd` and `promptHash`;
- `statements` and `unverified`.

A rising `unverified` count after a model or prompt change is the first signal of a grounding
regression.

## Not in V2

- **Actions with confirmation.** For example: replay this run, publish this version, answer this
  approval. They need a preview and confirmation design and their own evaluation cases.
- **Streaming answers.** The panel shows progress while the answer is prepared, but no text until
  it is complete.
- **Retrieval over knowledge bases.** The tools cover the workspace's operational data only.
