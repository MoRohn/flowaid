---
"@flowaid/worker": minor
"@flowaid/node-sdk": patch
---

Plugin hosts run under the Node permission model in development too, and plugins reach the
network only through `ctx.http`.

- A development checkout bundles the plugin host with esbuild and starts the bundle with the same
  flags as the compiled host: `--permission`, reads limited to the host's code, the provided
  packages and the plugin's own directory (no longer the repository root, so not `.env` or
  `.flowaid/`), and no writes, child processes, worker threads, addons, WASI or inspector.
- Installed plugin code may import only an allow-list of built-ins (`net`, `http`, `dns`,
  `child_process`, `module`, `vm` and the like are refused with `E_PLUGIN_BUILTIN_DENIED`);
  the global `fetch`, `WebSocket` and `EventSource` throw `E_PLUGIN_NETWORK_DENIED`; and
  `process.kill` only signals the host. On Node 25+ the permission model also refuses sockets.
- `@flowaid/node-sdk`, `@flowaid/workflow-core` and `zod` imported by a plugin resolve to the
  host's own instances.
