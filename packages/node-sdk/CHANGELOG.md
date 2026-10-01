# @flowaid/node-sdk

## 0.9.1

### Patch Changes

- @flowaid/shared@0.9.1
  - @flowaid/workflow-core@0.9.1

## 0.9.0

### Patch Changes

- 371cb0c: Plugin hosts run under the Node permission model in development too, and plugins reach the
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

- Updated dependencies [0778a7b]
- Updated dependencies [feb43fe]
- Updated dependencies [6b5c535]
  - @flowaid/workflow-core@0.9.0
  - @flowaid/shared@0.9.0

## 0.8.0

### Patch Changes

- @flowaid/shared@0.8.0
  - @flowaid/workflow-core@0.8.0

## 0.7.0

### Patch Changes

- @flowaid/shared@0.7.0
  - @flowaid/workflow-core@0.7.0

## 0.6.0

### Patch Changes

- @flowaid/shared@0.6.0
  - @flowaid/workflow-core@0.6.0

## 0.5.0

### Patch Changes

- Updated dependencies [859e8fc]
- Updated dependencies [702ab83]
  - @flowaid/workflow-core@0.5.0
  - @flowaid/shared@0.5.0

## 0.4.0

### Patch Changes

- Updated dependencies [0a0ec14]
  - @flowaid/workflow-core@0.4.0
  - @flowaid/shared@0.4.0
