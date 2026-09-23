# Security policy

## Reporting a vulnerability

Please do not open public issues for security problems. Report them privately through GitHub's **Report a vulnerability** form (Security tab, private vulnerability reporting) on this repository, and include:

- a description of the issue and its impact
- steps to reproduce or a proof of concept
- the version or commit you tested against

We aim to acknowledge reports within 3 business days and to ship a fix or mitigation within 30 days for confirmed high-severity issues.

## Scope

FlowAId executes workflows that call external services with stored credentials. The following are in scope:

- credential storage, encryption, and redaction
- workspace and API-key isolation
- the workflow runtime, worker, and code sandbox
- MCP and OpenAPI tool execution
- the web app, API, and SSE endpoints
- Docker Compose defaults

## Supported versions

FlowAId has not had a release yet. Until the first release, fixes land on `main` only. After it, only the latest minor release receives security fixes.

## Operating securely

- Set a strong `FLOWAID_MASTER_KEY` (or a backed-up `FLOWAID_MASTER_KEY_FILE`) and explicit `FLOWAID_JWT_PRIVATE_KEY`/`FLOWAID_JWT_PUBLIC_KEY`; never reuse the example values in production.
- Run the code sandbox worker in a separate container or host from the API. The compose stack's `worker-code` receives no `.env`, no master key, no provider key and a database role limited to the queue tables; keep it that way when you adapt the stack.
- The compose stack has no default passwords and publishes ports on loopback only; set `BIND_ADDRESS=0.0.0.0` only behind a TLS reverse proxy.
- Grant tools only the capabilities a workflow needs.
- Disable payload persistence for workflows that handle sensitive data.
