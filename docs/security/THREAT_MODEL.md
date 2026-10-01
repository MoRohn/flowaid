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

| boundary                                | threat                                                 | control                                                                                                                                                                                                                                                                    |
| --------------------------------------- | ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| browser → web proxy → API               | Forged `Host` or `X-Forwarded-*` headers               | The proxy drops the client's forwarded headers and sets its own. Local sign-in is refused when forwarding is untrusted. CSRF header, SameSite cookies. `CORS_ORIGINS=*` is refused in every environment.                                                                   |
| API key → workspace                     | A key used beyond its pins                             | Scopes are capped by the creator's role. Workflow pins apply everywhere. Environment pins apply to every route that takes an environment (deploy, rollback, secrets, credentials, runs, metrics, evaluations).                                                             |
| workflow → network (SSRF)               | Nodes reaching internal services or cloud metadata     | Addresses are checked at connect time (DNS rebinding included) with a complete IPv4/IPv6 blocklist. Credential headers are stripped on cross-origin redirects. The database query node goes through the same guard. `FLOWAID_ALLOW_PRIVATE_NETWORK` is an explicit opt-in. |
| workflow → code                         | Sandbox escape, resource abuse                         | isolated-vm with memory, CPU and wall-clock limits, on a separate `worker-code` host without the master key. It fails closed when isolates are unavailable.                                                                                                                |
| MCP stdio servers                       | Arbitrary commands, environment hijack                 | Off by default. Absolute-path allow-list, anchored argument patterns. Credential fields may not set system or loader variables (`PATH`, `LD_*`, `NODE_OPTIONS`, `JAVA_TOOL_OPTIONS`, …).                                                                                   |
| plugins                                 | Malicious packages                                     | Admin-only install, scope allow-list, sha512 verification, plugin host processes. Plugins are trusted code: see "Accepted risks".                                                                                                                                          |
| data → model (agents, RAG, Ask FlowAId) | Prompt injection through tool output or retrieved text | Shared untrusted-content envelope with caps. Agents treat it as data. Ask FlowAId's tools are read-only and unknown tools are refused. The evaluation set has an injection case.                                                                                           |
| Ask FlowAId → workspace data            | The assistant exposing data the caller cannot see      | Tools run in the caller's tenant transaction with their pins. No node inputs or outputs. Database errors are not relayed. It is audited without the question.                                                                                                              |
| AI → spend                              | Runaway cost                                           | Streamed generations are priced (V2). Agents check their limits before each turn (V2). Runs have `maxCostUsd`. Ask FlowAId allows 6 rounds and $0.25 per question, 20 per minute. AI builder generation and critique are rate limited.                                     |
| operator → data                         | Loss of the master key or database                     | [operations/BACKUP_AND_RESTORE.md](../operations/BACKUP_AND_RESTORE.md), with the key-check-value check after a restore                                                                                                                                                    |

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

- **Plugins run as trusted code.** In development (tsx) mode the plugin host has no Node
  permission model, and in either mode plugins can open network connections directly.
- **The api and the worker share one database role.** Both connect as `flowaid_app`, which is a
  member of `flowaid_rls_bypass` because their system scope needs it, so SQL injected into the
  api could still lift row-level security. The sandbox host's `flowaid_code` cannot (P3-4).
- **Mutations that commit nothing through the database are audited after the fact.** A route
  that only enqueues work gets its audit row when the response is sent, best effort; and a
  crash after commit can lose the resource id a handler learns after its transaction (the row
  then names the route's resource id or `-`) (P3-6).
- **The global request rate limit fails open on a Redis error.** With `REDIS_URL`, a Redis
  outage lets requests past the per-principal limit (the login throttles and the webhook replay
  cache fail closed) (P3-3).
- **Master-key rotation needs a stop.** `flowaid keys rotate-master` refuses to run while the api
  or the worker is connected, and moves only to a local key (file or variable) (P3-7).

## Fixed after V2

- **P3-4:** the row-level-security bypass was a custom setting any role could set, including the
  sandbox host's. `flowaid_bypass_rls()` now also requires membership in `flowaid_rls_bypass`
  (migration 0012), granted to `flowaid_app` and the owner only.
- **P3-3:** rate limits, login throttles and the webhook replay cache were per process. With
  `REDIS_URL` they live in Redis and hold across api replicas.
- **P3-6:** audit rows were written after commit, best effort. A request's row is now written
  in each transaction that changes something, before it commits.
- **P3-7:** there was no master-key rotation command. `flowaid keys rotate-master` re-wraps every
  KEK and re-seals every data key, verified and resumable.
