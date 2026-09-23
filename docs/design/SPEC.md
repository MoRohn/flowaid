# flowaid — Product & Engineering Specification (user-authored, verbatim intent)

Build a production-grade, open-source AI agent & workflow platform that succeeds earlier visual flow builders. Not a reskin/fork. Backend-first, API-first, TypeScript-first, strongly typed, plugin-extensible, provider-agnostic, TypeSafe-AI-first, observable, testable, self-hostable, useful with and without the canvas, and dramatically cleaner UX (Linear + Raycast + Vercel + modern IDE).

Architecture: UI → WorkflowDefinition → Compiler → ExecutionPlan → Runtime → Events/State → Observability. The UI is never the source of truth. Same workflow buildable via canvas, REST API, TS SDK, CLI, JSON/YAML, generated code, AI builder.

## Decision intelligence (core differentiator)

- `DecisionProvider` interface: decideBoolean / decideChoice / decideScore / batch. Implementations: TypeSafeDecisionProvider (default), RuleDecisionProvider, LLMDecisionProvider (structured-output adapter over any chat model), CustomDecisionProvider.
- TypeSafe System One is NOT a chat model: three primitives — Noul/Boolean (P(yes)), Choice (choice + probabilities + confidence), Score (fractional score + probabilities + confidence). These are native workflow nodes; probabilities/confidence are typed outputs wired to downstream logic (`decision.value`, `decision.confidence`, `decision.probabilities`).
- Separate Decision nodes (classification, routing, scoring, validation, policy, risk…) from Generation nodes (OpenAI/Anthropic/Google/xAI/Mistral/Groq/OpenRouter/Ollama/vLLM/OpenAI-compatible/custom). Visible in UI, API, runtime, traces, taxonomy.
- Hybrid pattern: TypeSafe decisions gate expensive generation; TypeSafe validates outputs; confidence gates route to auto / secondary validation / human.
- Normalized `DecisionResult<T> { value, confidence, probabilities?, provider, model, latencyMs, usage?, raw? }`.
- Batching of independent judgments; failover chain (TypeSafe → LLM adapter → human) visible in traces; provider health tracking.
- Platform must work with NO TypeSafe key (rules / LLM adapter / custom).

## Compiler

Canvas → WorkflowDefinition {id, version, name, description, inputs: Schema, outputs: Schema, nodes, edges, variables, secrets, execution: ExecutionPolicy} → schema validation → semantic validation → dependency analysis → graph compilation → ExecutionPlan → immutable published version. Detect: invalid connections, schema mismatches, unreachable nodes, unintended cycles, missing secrets/variables, incompatible types, unsafe recursion, impossible branches, dangling outputs, conflicting names, unavailable providers, invalid tool schemas, invalid decision configs. Errors surface on canvas.

## Control flow (beyond DAG)

Loop, ForEach, While, Retry, Until, Parallel, Race, Map, Reduce, Branch, Join, Subflow — all bounded: maxIterations, timeout, maxCost, maxTokens, exitCondition, failurePolicy. Runtime prevents infinite agent loops.

## Node system

Plugin-driven node SDK. Every node declares inputSchema/outputSchema/configSchema/credentialSchema (Zod → JSON Schema). Connections type-checked before execution; editor shows compatible ports; invalid connections rejected.
Categories (minimum): Flow (Start, End, Input, Output, Branch, Router, Parallel, Join, Loop, ForEach, Delay, Retry, Subflow, Event, Wait); TypeSafe Intelligence (Boolean, Choice, Score, Batch, Confidence Gate, Decision Router, Consensus, Decision Validator); AI (Agent, Generative Model, Prompt, Structured Generation, Embeddings, Reranker, Vision, Speech, Image Gen); Tools (Tool, MCP Tool, OpenAPI Tool, HTTP, GraphQL, Webhook, Code, Shell/Sandbox, DB Query); Data (Transform, JSON, Filter, Map, Merge, Split, Template, Extract, Schema Validate); Retrieval (Loader, Chunker, Embedding, Vector Store, Retriever, Hybrid Search, Reranker, Knowledge Base); Agent State (Working Memory, Conversation Memory, Durable State, KV, Session, Checkpoint); Human (Approval, Review, Form, Escalation, Manual Choice); Safety (Guard, Policy Check, PII Detector, Confidence Threshold, Rate Limit, Permission Check, Moderation); Developer (Log, Assertion, Test, Mock, Debug, Trace, Metric).
Third-party nodes via npm (`@community/node-slack`) — `export const node: NodeDefinition = { id, metadata, inputSchema, outputSchema, credentials, execute(ctx, input) }`.

## MCP & OpenAPI

MCP first-class: clients, servers, remote/local, tool discovery, resources, prompts, auth, permissions, connection testing; MCP server tools appear in palette; workflows exposed as MCP tools. OpenAPI 3.1: paste URL/YAML/JSON → parse → operations → typed tools → auth fields → validate args → execute → parse responses.

## API (OpenAPI 3.1 canonical)

/workflows /workflow-versions /runs /events /nodes /providers /models /tools /mcp /credentials /secrets /datasets /evaluations /templates /webhooks /schedules /audit. `POST /v1/workflows/:id/run` {input, mode: sync|async} → {run_id, status}. Sync, async, SSE, webhooks, polling, streaming. Typed error envelope `{error:{code,message,retryable,run_id,node_id}}`. Errors: WorkflowValidationError, NodeExecutionError, ToolExecutionError, ProviderError, CredentialError, TimeoutError, RateLimitError, HumanApprovalRequired, CancelledError.

## Durable runtime

API → queue → worker → runtime → node executors. Run states: queued, starting, running, waiting, waiting_for_human, retrying, completed, failed, cancelled, timed_out. Persist run, node executions, I/O, transitions, tool calls, errors, retries, probabilities, confidence, usage, latency, tokens, cost, logs, artifacts. Restart-safe. Checkpoints; retry node / resume / restart from node / fork / replay against new version. Event-sourced history (RUN_STARTED, NODE_STARTED, DECISION_COMPLETED, TOOL_CALLED, TOOL_RETURNED, NODE_RETRIED, HUMAN_APPROVAL_REQUESTED, HUMAN_APPROVAL_RECEIVED, RUN_COMPLETED…). Cancellation via AbortSignal through everything. Per-node retry policies (never blindly retry irreversible actions). Idempotency keys. Worker pools (general, gpu, browser, code, retrieval, high-memory). Sandboxed code execution (never in API process).

## Human-in-the-loop

Approve/Reject, select option, edit output, provide text/structured fields, escalate, resume. Durable suspension. Safe external review links.

## Versioning/environments

Immutable versions on publish; diff, rollback, clone, fork, compare, export, import; runs record exact version. Environments dev/staging/prod with separate credentials/vars/webhooks; promote.

## Evaluation

Datasets (input, expected result/decision/range, required branch, forbidden action, metadata); run versions against dataset; compare accuracy, calibration, latency, cost, tool success, branch correctness, schema success, completion rate; regression report before publish.

## Observability

Dashboard metrics (runs, success/error rate, latency p50/p95/p99, AI cost, tool latency, decision confidence, human review rate, retry rate, provider failures) with filters. Full structured traces; TypeSafe-based automated trace review (NO_ACTION/REVIEW/PRIORITY_REVIEW/FILE_BUG/PAGE_ON_CALL). Distributed-trace-style run timeline.

## Knowledge/RAG

Sources → ingest → normalize → chunk → metadata → embed → index → retrieve → rerank; vector-store adapters (pgvector first; Qdrant, Pinecone, Weaviate, Milvus, Chroma, Elasticsearch, OpenSearch, custom); hybrid retrieval signals.

## Security

Credentials never in workflow JSON (references only), encrypted at rest, providers (env, encrypted DB, AWS/Azure/GCP/Vault/custom), redaction in logs/traces/errors/UI/exports. RBAC, workspaces, API keys, service accounts, JWT/OIDC, SSO hooks, credential scopes, tool capabilities (github.read, stripe.refund…), audit logs, rate limiting, validation, CORS, secure headers, signed webhooks.

## UI

Layout: top bar (breadcrumb, Run, Publish, …); left nav (Workflows, Agents, Runs, Templates, Integrations, Knowledge, Evaluations, Credentials, Settings); canvas; right inspector; bottom run/trace/log/output panel. Palette via +, shortcut, command palette, right-click, drag, AI builder. Compact nodes (name, purpose, provider, key config, state, exec summary e.g. "✓ 84ms", confidence on decision nodes). Live execution visualization. Trace timeline with probabilities. AI workflow builder; AI workflow critic (static analysis); cost optimizer; smart model routing. Exceptional dark mode. Neutral surfaces, thin borders, subtle elevation, small type hierarchy, restrained accent.

## Stack & repo

pnpm + Turborepo, TS strict (noUncheckedIndexedAccess), Next.js + React + XYFlow + Tailwind + shadcn/ui, Fastify, PostgreSQL + Drizzle, Redis/BullMQ (Redis optional where possible), S3/MinIO, Zod, OpenAPI 3.1, Vitest, Playwright, Docker. Monorepo: apps/{web,api,worker,docs}; packages/{workflow-core, workflow-runtime, workflow-compiler, workflow-sdk, node-sdk, nodes-core, providers, provider-typesafe, provider-openai, provider-anthropic, provider-ollama, mcp, openapi-tools, credentials, observability, evaluation, database, ui, config, shared}. No circular deps; domain logic independent of React/HTTP. workflow-core = portable TS only. DB entities: users, workspaces, memberships, workflows, workflow_versions, workflow_deployments, runs, run_events, node_runs, artifacts, credentials, secret_references, agents, knowledge_sources, documents, evaluation_sets, evaluation_cases, evaluation_runs, api_keys, webhooks, schedules, plugins, audit_events. Retention by data class; privacy flags (sensitive, containsPII, doNotPersist, redactFields). FlowAId importer isolated (FlowAIdImporter → CanonicalWorkflowDefinition, never extends). Apache 2.0, clean attribution. CLI: dev, login, workflow list/validate/run/export/deploy, logs, eval. SDK: `client.workflows.run(id, input)`, `for await (const ev of run.stream())`.

## Quality bar

No fake buttons, fake analytics, mocked integrations presented as complete, placeholder dashboards, TODO implementations, hard-coded demo results, dead navigation, visual-only nodes, unimplemented backend actions. Exclude unfinished features from navigation.

## First vertical slice (must be real, end to end)

Authentication; Workflow CRUD; Visual Builder; Compiler; Versions; Worker runtime; Run history; SSE streaming; TypeSafe provider; Boolean/Choice/Score decisions; Branching; HTTP tool; MCP tool; OpenAI-compatible generation; Human approval; Logs; Trace viewer; Docker Compose; PostgreSQL.

Demo workflows: (1) Intelligent Support Triage: Input → TypeSafe Intent Choice → Urgency Score → Escalation Noul → Router(billing/technical/security/general) → tool calls → generative response → TypeSafe safety decision → Confidence Gate → auto respond | human approval. (2) GitHub Issue Triage: webhook → actionable? → bug/feature/docs/question → severity → duplicate search → duplicate? → labels → route. (3) Research Agent: question → planner → parallel research tools → relevance/reliability decisions → evidence store → synthesis → completeness check → return/loop (bounded).

## Acceptance test (from clean clone)

`git clone; cp .env.example .env; docker compose up` → open browser → create workflow with Input → TypeSafe Choice → Branch → HTTP Tool → Generation Model → TypeSafe Boolean → Human Approval/Output → configure credentials → publish → call via API → watch live → inspect probabilities, generated output, tool args/results, latency and cost → approve suspended run → see resume → replay → edit → publish v2 → compare versions → run evaluation suite.

## Design principles

Backend first; intelligence typed; deterministic logic beats AI when possible; TypeSafe for judgments; generative models for generation; confidence drives automation; every run inspectable; open interfaces; provider independence; self-hosting is a product feature.

---

_Editorial notes (added 2026-09-22 by the design review; not part of the verbatim spec above):_ "FlowAId importer" / `FlowAIdImporter` in §Stack means the **FlowAId importer**, implemented as `packages/importer` (`@flowaid/importer`, ARCHITECTURE.md §10.9). The route families `/datasets`, `/events` and `/secrets` map onto the routes listed in API.md §3 (OpenAPI tags keep the spec names). The acceptance test's final steps include the evaluation regression report and, per CODE_EXPORT.md §5, downloading the workflow as a runnable code package.
