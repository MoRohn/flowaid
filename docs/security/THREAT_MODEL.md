# FlowAId threat model (V2)

This is the security model as of V2. How to report a problem, the local-mode boundary and the
private-network setting are in [SECURITY.md](../../SECURITY.md). The authoritative controls are
described in [design/ARCHITECTURE.md](../design/ARCHITECTURE.md). This page names the assets,
the boundaries, the threats, and what V2 changed.

## Deployment modes

| mode                                             | who reaches it                | authentication                                                                                |
| ------------------------------------------------ | ----------------------------- | --------------------------------------------------------------------------------------------- |
| **local** (default, `pnpm start` on 127.0.0.1)   | the person at this computer   | Loopback sign-in without a password. Host header checked, forwarded headers not trusted.      |
| **password** (Compose, or any non-loopback bind) | people who can reach the host | Email and password sessions (ES256, 15-minute access tokens, rotating refresh), plus API keys |

Since V2, `pnpm start --host 0.0.0.0` switches to password mode, and the API refuses local
sign-in for requests that came through a proxy from another computer. That closes the
LAN-takeover finding (S1).

## Assets

- **Stored credentials:** provider keys, database DSNs, OAuth tokens. They are envelope-encrypted
  under the master key.
- **Run data:** inputs, outputs, events and human-task payloads. These may contain personal data.
- **The ability to execute:** code nodes, HTTP and database calls, MCP servers, plugins.
- **Spend:** provider calls cost money.

## Trust boundaries and threats

| boundary                                | threat                                                 | control                                                                                                                                                                                                                                                                                                                                                           |
| --------------------------------------- | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| browser → web proxy → API               | Forged `Host` or `X-Forwarded-*` headers               | The proxy drops the client's forwarded headers and sets its own. Local sign-in is refused when forwarding is untrusted. CSRF header, SameSite cookies. `CORS_ORIGINS=*` is refused in every environment.                                                                                                                                                          |
| API key → workspace                     | A key used beyond its pins                             | Scopes are capped by the creator's role. Workflow pins apply everywhere. Environment pins apply to every route that takes an environment (deploy, rollback, secrets, credentials, runs, metrics, evaluations).                                                                                                                                                    |
| workflow → network (SSRF)               | Nodes reaching internal services or cloud metadata     | Addresses are checked at connect time (DNS rebinding included) with a complete IPv4/IPv6 blocklist. Credential headers are stripped on cross-origin redirects. The database query node goes through the same guard. `FLOWAID_ALLOW_PRIVATE_NETWORK` is an explicit opt-in.                                                                                        |
| workflow → code                         | Sandbox escape, resource abuse                         | isolated-vm with memory, CPU and wall-clock limits, on a separate `worker-code` host without the master key. It fails closed when isolates are unavailable.                                                                                                                                                                                                       |
| MCP stdio servers                       | Arbitrary commands, environment hijack                 | Off by default. Absolute-path allow-list, anchored argument patterns. Credential fields may not set system or loader variables (`PATH`, `LD_*`, `NODE_OPTIONS`, `JAVA_TOOL_OPTIONS`, …). Only the worker spawns: the API checks the policy (admin scope) and hands tests and discovery, saved or not, to the worker, which checks it again and audits each spawn. |
| plugins                                 | Malicious packages                                     | Admin-only install, scope allow-list, sha512 verification, plugin host processes under the Node permission model with a built-in allow-list. What remains: see "Accepted risks".                                                                                                                                                                                  |
| data → model (agents, RAG, Ask FlowAId) | Prompt injection through tool output or retrieved text | Shared untrusted-content envelope with caps. Agents treat it as data. Ask FlowAId's tools are read-only and unknown tools are refused. The evaluation set has an injection case.                                                                                                                                                                                  |
| Ask FlowAId → workspace data            | The assistant exposing data the caller cannot see      | Tools run in the caller's tenant transaction with their pins. No node inputs or outputs. Database errors are not relayed. It is audited without the question.                                                                                                                                                                                                     |
| AI → spend                              | Runaway cost                                           | Streamed generations are priced (V2). Agents check their limits before each turn (V2). Runs have `maxCostUsd`. Ask FlowAId allows 6 rounds and $0.25 per question, 20 per minute. AI builder generation and critique are rate limited.                                                                                                                            |
| operator → data                         | Loss of the master key or database                     | [operations/BACKUP_AND_RESTORE.md](../operations/BACKUP_AND_RESTORE.md), with the key-check-value check after a restore                                                                                                                                                                                                                                           |

## Findings fixed in V2

Detailed in [FLOWAID_V2_CODE_REVIEW.md](../project/FLOWAID_V2_CODE_REVIEW.md) §Security, with tests
named in the commits.

- **S1:** local-mode takeover through `--host 0.0.0.0`.
- **S2:** custom credential headers forwarded across origins.
- **S3:** the database query node bypassed the address guard.
- **S4:** CORS `*` was accepted with credentials.
- **B1:** environment pins were ignored by deploy, rollback, secrets and credentials routes.
- **S5:** stdio MCP environment names; IPv4-compatible, 6to4, Teredo and NAT64 addresses.
- **B5:** readiness leaked database error text.
- **AI2:** unmarked and uncapped tool and retrieval content in agent prompts.
- **AI3:** agent budget checks ran after a turn instead of before.

## Accepted risks and open items

- **Plugins are admin-installed code in a restricted process, not a sandbox.** Each package runs
  in its own plugin host process (`apps/worker/src/plugins/host.ts`), in production and in
  development alike (a development checkout runs an esbuild bundle of the host, because a
  TypeScript loader cannot run under the permission model). `isolation.test.ts` proves each
  enforced item below with a hostile plugin.
  - **Enforced by Node's permission model:** reads only of the host's code, the packages
    provided to plugins and the plugin's own directory (not the repository root, `.env`,
    `.flowaid/`, `/data` or the master key file); no file writes; no child processes, worker
    threads, native addons, WASI or inspector; no `process.binding`. On Node 25+ (`--allow-net`
    exists and is withheld) no sockets or DNS either.
  - **Enforced only in-process on Node 24** (the release images' runtime, whose permission model
    has no network scope): plugin code may import only an allow-list of built-ins (no `net`,
    `tls`, `http(s)`, `http2`, `dgram`, `dns`, `child_process`, `worker_threads`, `cluster`,
    `module`, `vm`, `v8`, `os`...), checked by a module hook that covers `import`, `require` and
    `process.getBuiltinModule`; the global `fetch`, `WebSocket` and `EventSource` throw; and
    `process.kill` only signals the host itself. This runs in the plugin's own realm, so it is
    defence in depth: an object that leaks a denied module (from the host or a provided package)
    would bypass it. The supported way out is `ctx.http`, the worker's SSRF-guarded fetch under
    the workspace egress policy.
  - **Not covered:** CPU time (a plugin can spin; only the node's timeout and the 512 MiB heap
    cap bound it), the IPC channel itself (a plugin can send the worker well-formed requests for
    the context services the executing node may use, including the credential slots it
    declared), and side channels within the host process (the other nodes of the same package
    run there). Bundled packages (`@flowaid/nodes-langchain`) ship with the worker and are not
    held to the built-in allow-list.
- **The row-level-security bypass is a custom setting.** Any database role could set it,
  including the sandbox host's role. Gating it on role membership is open (P3-4).
- **Rate limits and login throttles are in memory.** They are per process, which is fine locally.
  Redis-backed stores for the scale profile are open (P3-3).
- **Audit rows are written after commit, best effort.** An outbox is open (P3-6).
- **No `flowaid keys rotate-master` command yet.** The library supports rotation (P3-7).
