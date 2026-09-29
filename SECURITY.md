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
- **Close window and Quit FlowAId.** `./flowaid` listens on `127.0.0.1` at a port the OS picks
  for the API's `/v1/desktop` requests, and checks a bearer token generated for each launch that
  only the API receives (`FLOWAID_LAUNCHER_URL`/`TOKEN`; configuration validation refuses a
  non-loopback URL). The routes accept a session with the `admin` scope and the CSRF header,
  never an API key, and both mutations are audited. The menu bar helper only prints `open` or
  `quit` to the launcher, and exits with it. The API reports only counts to the launcher (runs in
  progress, approvals waiting) for the icon.
- **The launcher record.** `.flowaid/launcher.json` (owner-only, like `.flowaid/dev.env`) holds
  the running launcher's pid, its control channel's URL and token, and the pids it started. A
  second `./flowaid` uses it to open the running instance's window. After a crash, the next start
  ends a recorded pid only while that process's command line still matches what FlowAId started,
  so a program that reused the pid is left alone.

## Private network access

Outbound connections that workflows make refuse loopback, private-network, link-local and
reserved addresses (including cloud metadata endpoints), also after DNS resolution and on every
redirect. This covers the HTTP, GraphQL and database query nodes, AI nodes' HTTP calls,
knowledge loaders, OpenAPI tools (import and calls), HTTP MCP servers and notification
webhooks. It stops a workflow from probing the machine or network FlowAId runs on.

`FLOWAID_ALLOW_PRIVATE_NETWORK=true` (off by default; set it for both the api and the worker)
lifts that restriction for all of them at once, so flows can call your own `localhost` API or
query a local PostgreSQL. The trade-off: anyone who can edit or import a workflow can then reach
every service on your computer and your network, including admin interfaces that trust local
callers. Turn it on only when you are the only author, and never on a cloud host, where the
metadata endpoint hands out the host's credentials. `pnpm start` does not turn it on for you.
In the compose stack the `worker-code` sandbox host does not read `.env`, so code nodes there
stay restricted.

The one exception is `OLLAMA_HOST`: the exact origin you configure there is always reachable
(and redirects from it are checked like any other request), so a local Ollama works without
opening the private network to every workflow.

## Operating securely

- Set a strong `FLOWAID_MASTER_KEY` (or a backed-up `FLOWAID_MASTER_KEY_FILE`) and explicit `FLOWAID_JWT_PRIVATE_KEY`/`FLOWAID_JWT_PUBLIC_KEY`; never reuse the example values in production.
- Run the code sandbox worker in a separate container or host from the API. The compose stack's `worker-code` receives no `.env`, no master key, no provider key and a database role limited to the queue tables; keep it that way when you adapt the stack.
- The compose stack has no default passwords and publishes ports on loopback only; set `BIND_ADDRESS=0.0.0.0` only behind a TLS reverse proxy.
- Grant tools only the capabilities a workflow needs.
- Disable payload persistence for workflows that handle sensitive data.
