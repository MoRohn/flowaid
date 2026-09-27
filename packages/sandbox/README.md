# @flowaid/sandbox

Executors for the `code` worker pool (ARCHITECTURE.md §10.7). Nodes reach them through
`ctx.sandbox` (RFC-0019); the runtime binds an executor to the node's own `http`, `tools` and
`state` as bridges.

- **`IsolatedVmSandbox`** (default, `SANDBOX_MODE=isolated-vm`). One isolate per run with a heap
  limit (128 MiB by default) and no inspector. Code gets no `require`, `process` or Node globals. It
  has a CPU time limit plus a wall-clock deadline of `min(timeout, 120 s)` that disposes the isolate,
  so a `while (true)` and an `await`-forever both end, and cancellation disposes it too. Bridges:
  `fetch` (only with `allowNetwork`, to allow-listed hosts), `console`/`log` (1 000 lines, 8 KiB per
  line), `tools.call` (only `config.tools`, never approval-gated tools) and `state.get/set` (keys
  scoped to the run). Every value crossing the bridge is capped at 4 MiB. The return value is
  validated against the declared output schema.
- **`ContainerSandbox`** (`SANDBOX_MODE=container`, recommended for multi-tenant production). Each
  run is a throwaway `docker run` with `--network none`, `--read-only`, a small `noexec` tmpfs,
  memory and pids limits, `--cap-drop ALL`, `no-new-privileges` and an unprivileged user. An
  optional runtime such as gVisor (`runsc`) is supported. It is the only host for `shell`, and
  shell images come from an allow-list.
- Code is an async function body receiving `inputs`. TypeScript is stripped by esbuild once per
  content hash (LRU 200).

`isolated-vm` is an optional native dependency with prebuilt binaries for Node 24 (the supported
runtime). On a Node version without a build, `pnpm install` still succeeds, and runs fail with
`SANDBOX_UNAVAILABLE` and a hint to use Node 24 or the container mode.
