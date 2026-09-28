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

| Version                  | Security fixes                     |
| ------------------------ | ---------------------------------- |
| latest `0.x` minor       | yes, as a patch release            |
| older `0.x` minors       | no: upgrade to the latest minor    |
| `main` (unreleased code) | yes, fixed before the next release |

While FlowAId is 0.x, only the latest minor release receives fixes. Published images
(`ghcr.io/morohn/flowaid-*`) carry signed build provenance; verify them as described in
[docs/RELEASING.md](docs/RELEASING.md#verifying-an-image) before you deploy.

## Local mode trust boundary

In local mode (`FLOWAID_AUTH_MODE=local`, or `auto` with loopback `FLOWAID_BASE_URL` and
`FLOWAID_WEB_URL`, which is how `pnpm start` runs) FlowAId has no sign-in: whoever can reach
it on this computer is its owner. The boundary is the computer itself:

- The api hands out the automatic owner session (`POST /v1/auth/local`) only to a request that
  comes from a loopback address, whose every `X-Forwarded-For` hop is loopback, whose `Host`
  (or `X-Forwarded-Host`) and `Origin` are local names (`localhost`, `*.localhost`, `127.x`,
  `[::1]`) and that carries `X-Requested-With: flowaid`. The Host and Origin checks stop other
  websites from reaching it through DNS rebinding; the header forces a CORS preflight.
- `FLOWAID_BASE_URL` and `FLOWAID_WEB_URL` must be loopback URLs while the mode is `local`;
  configuration validation refuses anything else.
- **Bind to loopback only.** `pnpm start` binds to `127.0.0.1` by default. Anything that makes
  FlowAId reachable from another computer (`--host 0.0.0.0`, a non-loopback `HOST`, a published
  port, a reverse proxy or tunnel) must run in password mode (`FLOWAID_AUTH_MODE=password`),
  as the compose stack does. A change that enforces this at startup is in progress; until it
  lands, it is your responsibility.
- Other local users and processes on the same computer are inside the boundary. Do not run
  local mode on a shared machine.

## Operating securely

- Set a strong `FLOWAID_MASTER_KEY` (or a backed-up `FLOWAID_MASTER_KEY_FILE`) and explicit `FLOWAID_JWT_PRIVATE_KEY`/`FLOWAID_JWT_PUBLIC_KEY`; never reuse the example values in production.
- Run the code sandbox worker in a separate container or host from the API. The compose stack's `worker-code` receives no `.env`, no master key, no provider key and a database role limited to the queue tables; keep it that way when you adapt the stack.
- The compose stack has no default passwords and publishes ports on loopback only; set `BIND_ADDRESS=0.0.0.0` only behind a TLS reverse proxy.
- Grant tools only the capabilities a workflow needs.
- Disable payload persistence for workflows that handle sensitive data.
