# Publishing a FlowAId node package

A plugin is an npm package of nodes built with `@flowaid/node-sdk`. The platform finds it by
the `flowaid-node` keyword, installs it only when it is on the server's allow-list, and verifies
its tarball against the integrity the registry publishes (ARCHITECTURE.md §3.5).

## Start from the scaffold

```sh
npx @flowaid/create-flowaid-node @acme/nodes-crm
cd nodes-crm && npm install && npm test
```

It writes a `defineNode` example, a harness test, `manifest.json` with a test that keeps it
current, and the `package.json` fields below.

## Checklist

Before every `npm publish`:

- [ ] **Name and ids.** Every node type id starts with the package name followed by a dot
      (`@acme/nodes-crm.lookup`). Installs are refused otherwise (`E_PLUGIN_ID_PREFIX`). The
      `@flowaid` scope is reserved for the platform.
- [ ] **Discovery fields.** `package.json` has the `flowaid-node` keyword and a `flowaid` field:
      `{ "package": "nodePackage", "sdk": "^0.1.0", "manifest": "manifest.json" }`. Without them
      `flowaid plugin search` does not list the package and installs are refused
      (`E_PLUGIN_NOT_A_PLUGIN`).
- [ ] **SDK range.** `flowaid.sdk` accepts the node SDK version of the servers you target
      (`E_PLUGIN_SDK_RANGE` otherwise). Keep `@flowaid/node-sdk` a peer dependency.
- [ ] **Manifest is current.** Run `npm run manifest` after changing a node, and `npm test`: the
      server reads node types from `manifest.json` without running your code
      (`E_PLUGIN_MANIFEST` when it is missing or invalid). `manifest.json` is in `files`.
- [ ] **Build output ships.** `npm run build`, and `files` lists `dist`, `manifest.json` and
      `README.md` only: no tests, fixtures or secrets (`npm pack --dry-run` shows the list).
- [ ] **No install scripts.** Plugins are installed with `--ignore-scripts`; do not depend on
      `postinstall` or native builds.
- [ ] **Declared capabilities.** Every node lists the capabilities it uses (`http`,
      `credentials`, `generation`, …) and its credential slots; the platform grants nothing else.
- [ ] **Idempotency.** Nodes with side effects declare `idempotency: "none"` or `"keyed"` so
      retries stay safe.
- [ ] **Secrets.** Nodes read secrets through their credential slots, never from the
      environment; nothing secret is logged or returned in outputs.
- [ ] **Versioning.** Bump the package version on every publish, and a node's `version` when its
      config, ports or behaviour change incompatibly (with a migration when possible).
- [ ] **Integrity.** Publish with a current npm so the registry records a `sha512` integrity.
      Operators can pin it: `flowaid plugin add @acme/nodes-crm@1.2.0 --frozen sha512-…`.
- [ ] **README.** What each node does, its credentials, and an example workflow.

## Installing

An operator adds your scope or package to `FLOWAID_PLUGIN_ALLOWED_SCOPES` (for example
`@flowaid,@acme`), then:

```sh
flowaid plugin search crm              # the registry, keyword flowaid-node
flowaid plugin add @acme/nodes-crm     # server-side: allow-list, SDK range, integrity, manifests
flowaid plugin disable @acme/nodes-crm
```

or uses _Integrations → Plugins_ in the web app. Workers load newly installed or re-enabled
plugins when they restart. `FLOWAID_PLUGIN_REGISTRY` points the platform at a private registry.
