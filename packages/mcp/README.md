# @flowaid/mcp

The MCP client side of flowaid (ARCHITECTURE.md §10.2), built on `@modelcontextprotocol/sdk`.

- **Sessions and pool.** `McpSession` wraps the SDK client (paginated `listTools`, `callTool`,
  resources, prompts, `ping`) with per-call timeouts and abort. `McpSessionPool` keeps one session
  per `(serverId, credentialId)`, dedupes concurrent connects, backs off exponentially after
  failures (health: healthy / degraded / down), drops sessions on transport errors and sweeps idle
  ones.
- **Transports.** Streamable HTTP (preferred, falling back to legacy SSE on 404/405), SSE, and
  stdio. The HTTP transports take the caller's fetch (the worker passes SafeFetch).
- **stdio policy.** Off unless `MCP_STDIO_ENABLED`; the command must be on
  `FLOWAID_MCP_STDIO_ALLOWED_COMMANDS` (absolute paths, optional args regex). `validateStdioConfig`
  rejects shells, package runners (`npx -y …`), code-evaluating flags, shell metacharacters and
  loader environment names. The child gets `FLOWAID_MCP_STDIO_ENV_ALLOWLIST` plus the bound
  credential's fields, `shell: false`, a fresh temp cwd, its own process group (killed on close,
  timeout or cancel) and a 1 MiB stderr buffer; `onSpawn` is the audit hook.
- **Discovery.** `discoverTools` turns tools into `ToolDefinition`s: sanitised names (the original
  kept in `nameMap`), descriptions capped at 1 KiB without control or bidi characters, idempotency
  from `readOnlyHint` / `idempotentHint`, capabilities `<server>.read|write`, and
  `W_MCP_TOOL_SUSPICIOUS` warnings (such tools also require approval).
- **toolPolicy.** allow / deny / approvalRequired globs over tool names and resource URIs.
- **Caller.** `createMcpToolCaller(pool, lookup)` is the MCP half of `ctx.tools.call`: `mcp`
  sources plus the `mcp_resource_read` and `mcp_prompt_get` builtins used by the resource and
  prompt nodes.
- **Auth.** `mcp.headers`, `http.bearer` and `mcp.oauth` credentials; OAuth refresh; PKCE helpers.
- **Exposure.** `buildExposedTools`, `exposedResources` and `runOutcomeToCallResult` for serving
  workflows as MCP tools, filtered by the token's workflow pin.

Tests run a real streamable-HTTP MCP server in process and a real stdio server
(`fixtures/stdio-server.mjs`), including the process-group kill.
