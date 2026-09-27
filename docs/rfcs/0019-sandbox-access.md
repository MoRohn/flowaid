# RFC-0019: Sandbox access for code and shell nodes

- Status: accepted (2026-09-27)
- Raised by: P2-06 — `flowaid.tools.code` and `flowaid.tools.shell` declare the `sandbox` capability, but no `ExecutionContext` service carried it, so a node had no way to reach the executor the runtime is given (`CODE_EXPORT.md` §2, `runLocally({ sandbox })`)
- Implemented by: P2-06
- Affects: `CONTRACTS.ts` §15 (new `SandboxRunRequest`, `SandboxLogLine`, `SandboxRunResult`, `SandboxShellRequest`, `SandboxShellResult`, `SandboxBridges`, `SandboxExecutor`), §16 (`ExecutionContext.sandbox?`, new `SandboxAccess`); `@flowaid/workflow-core` 0.3.1 → 0.3.2

## Motivation

The capability list has had `'sandbox'` since the first contract draft, and ARCHITECTURE.md §10.7 describes the executor's limits and bridges, but the contract never said how a node reaches it. `@flowaid/sandbox` may depend only on `workflow-core` and `shared`, and `workflow-runtime` may not import `sandbox`, so the interface both sides share has to live in `workflow-core`.

## Change

- §15: the request/result shapes and `SandboxExecutor { kind; run(req, bridges); shell?(req, signal) }`, with `SandboxBridges { signal; fetch?; callTool?; stateGet?; stateSet? }` — the host services the code may reach, already scoped to the node.
- §16: `ExecutionContext.sandbox?: SandboxAccess`, gated by the `sandbox` capability like every other service; `SandboxAccess { run(req); shell(req) }` binds the executor to the calling node's bridges (network only with `allowNetwork` and allow-listed hosts; tools only from `req.tools`; state keys prefixed `run:<id>`).
- Without an executor (a pool that has none, or `runLocally` without `sandbox`) both methods fail with `SandboxError` "SANDBOX_UNAVAILABLE".

Additive: optional field and new types only.

## Compatibility

- Stored data: none.
- Wire: none; the types are in-process.
- Design docs: ARCHITECTURE.md §10.7 references this RFC.

## Tests

- `@flowaid/sandbox`: limit enforcement, bridges, output validation.
- `@flowaid/workflow-runtime`: the executor exposes `ctx.sandbox` only to nodes declaring `sandbox`, and reports SANDBOX_UNAVAILABLE without an executor.
- `@flowaid/nodes-core`: harness tests of `code` and `shell` against a fake `SandboxAccess`.

## Alternatives considered

- Special-casing `code`/`shell` in the runtime executor: hides the node's behaviour from the SDK and third-party nodes.
- Passing the executor through `ctx.tools` as a builtin tool: loses typed requests and makes bridges indistinguishable from tool calls.
