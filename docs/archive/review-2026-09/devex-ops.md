# Review — developer experience and operations

Scope: repository root, `packages/config`, ESLint + boundaries, Turbo, Vitest, Prettier,
`.editorconfig`, `.gitignore`, `docker/`, `.env.example` vs `packages/env`, `README.md`,
CI, contributor docs, versioning, hooks, dependency pinning, Node version, scripts.

Reviewed on 2026-09-22 against the working tree (no commits exist yet). Everything below
was verified by running the command named or reading the file:line cited.

## What was run

| Command                                                     | Result                                                                                                                                                                                                                 |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm boundaries`                                           | **FAILS** — `ARCHITECTURE.md lists "importer" but boundaries.json does not` (scripts/check-boundaries.test.ts:208)                                                                                                     |
| `pnpm turbo run typecheck lint`                             | typecheck green; **lint FAILS** — `packages/workflow-core/src/expr/typer.test.ts:74` unused `codes` (`@typescript-eslint/no-unused-vars`). 7.6 s wall                                                                  |
| `pnpm turbo run test`                                       | green (5 packages, 7.0 s wall); 4 warnings `no output files found for task …#test` because `turbo.json` declares `outputs: ["coverage/**"]` and nothing produces coverage                                              |
| `pnpm env:check`                                            | green (`.env.example` and `packages/env/README.md` up to date)                                                                                                                                                         |
| `pnpm format:check`                                         | **FAILS** — 292 files, including `README.md`, `turbo.json`, `scripts/check-boundaries.test.ts`, most of `packages/workflow-core/src`, and `docs/design/CONTRACTS.ts` (the frozen contract is inside the `format` glob) |
| `pnpm lint:root`, `pnpm typecheck:root`                     | green                                                                                                                                                                                                                  |
| `pnpm install --frozen-lockfile --offline`                  | lockfile in sync; "Lockfile passes supply-chain policies"                                                                                                                                                              |
| `docker compose config`                                     | valid; 7 services (`postgres, minio, minio-init, api, worker, worker-code, web`)                                                                                                                                       |
| `pnpm exec turbo run lint --filter=@flowaid/env --dry=json` | `globalCacheInputs.files` is **empty**: `boundaries.json`, `eslint.boundaries.js`, root `tsconfig.json` are not part of any task hash                                                                                  |
| `node --version` / `pnpm --version`                         | v25.2.1 / 12.5.1 (Dockerfiles target Node 24; no `.nvmrc`)                                                                                                                                                             |

## Findings (details; ids match the structured output)

### 1. `boundaries-dag-drift` — the DAG check is red

`docs/design/ARCHITECTURE.md` §1.1 lists `importer`, `codegen`, `langchain`, `nodes-langchain`.
`boundaries.json` has `importer` (line 73) and none of the other three; the
`api` allow list also lacks `codegen`. `scripts/check-boundaries.test.ts` compares the two
and fails. `README.md` is inconsistent with itself: the layout block says
`importer/`, the LangChain section says `packages/importer/src/langchain-map.ts`.

Fix: in `boundaries.json` rename `importer` → `importer` (`packages/importer`),
add

```json
"codegen":         { "dir": "packages/codegen",         "allow": ["workflow-core", "workflow-compiler", "shared"] },
"langchain":       { "dir": "packages/langchain",       "allow": ["providers", "node-sdk", "workflow-core", "shared"] },
"nodes-langchain": { "dir": "packages/nodes-langchain", "allow": ["langchain", "node-sdk", "providers", "workflow-core", "shared"] }
```

add `"codegen"` and `"importer"` to `api.allow` (replace `importer`), add
`"nodes-langchain"` to `worker.allow` if the worker loads it as a plugin by name (LANGCHAIN.md
§3 says it is loaded as a plugin, so a package.json dependency is optional). Update the
README layout block. Re-run `pnpm boundaries`.

### 2. `langchain-import-boundary` — the documented LangChain rule is not enforced

ARCHITECTURE.md §1.1 "Rules" and LANGCHAIN.md §7 (line 66): `langchain` and `@langchain/*`
may be imported only by `packages/langchain`, `packages/nodes-langchain`,
`packages/importer/src/langchain-map.ts`, `packages/codegen` templates and the worker's
plugin loader; "the boundaries check fails the build otherwise". `eslint.boundaries.js`
contains no such pattern (`boundaryRuleOptions` builds only the `@flowaid/*` regex, the
relative-path regex and the Node-built-in regex). README.md's LangChain section repeats the
false claim.

Fix:

- `boundaries.json`: add an optional `"external": { "langchain": true }` flag (schema in
  `scripts/boundaries.schema.json`) on `langchain`, `nodes-langchain`, `codegen`; add an
  optional per-package `"externalFiles": ["src/langchain-map.ts"]` for `importer` and
  `["src/plugins/**"]` for `worker`.
- `eslint.boundaries.js`: in `boundaryRuleOptions`, when the package is not flagged, push
  `{ regex: "^(langchain|@langchain/)", message: "LangChain may only be imported by @flowaid/langchain, @flowaid/nodes-langchain, … (LANGCHAIN.md)" }`;
  `boundaryConfigs()` emits an extra `files: [<dir>/<externalFiles>]` entry without the
  pattern for the file-level exceptions.
- `scripts/check-boundaries.test.ts`: assert `lint("workflow-runtime", 'import {ChatOpenAI} from "@langchain/openai"')` → 1 message, `lint("api", 'import "langchain"')` → 1, `lint("langchain", …)` → 0; assert that only flagged packages declare `langchain`/`@langchain/*` in package.json.

### 3. `lint-red` — `pnpm lint` fails today

`packages/workflow-core/src/expr/typer.test.ts:74` defines `codes()` and never uses it.
Delete the helper or use it. Then make lint a required CI check (finding 5) so it cannot
regress silently. (The task brief states lint passes; it does not.)

### 4. `prettier-red` and frozen contract in the format glob

`pnpm format:check` reports 292 files. `packages/workflow-core/vitest.config.ts` is
single-quoted, `turbo.json` has a long line, etc. `pnpm format` would also rewrite
`docs/design/CONTRACTS.ts`, which IMPLEMENTATION_PLAN.md says is frozen after Wave 0.
Fix: add `docs/design/CONTRACTS.ts` and `brand/` to `.prettierignore`, run `pnpm format`
once, and put `format:check` into CI and the pre-commit hook (findings 5, 18).

### 5. `no-ci` — there is no `.github/`

Proposed `.github/workflows/ci.yml` (all steps exist today except the gated ones):

```yaml
name: ci
on:
  push: { branches: [main] }
  pull_request:
concurrency: { group: ci-${{ github.ref }}, cancel-in-progress: true }
env: { TURBO_TELEMETRY_DISABLED: 1, NEXT_TELEMETRY_DISABLED: 1, DO_NOT_TRACK: 1 }
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4            # reads packageManager from package.json
      - uses: actions/setup-node@v4
        with: { node-version-file: .nvmrc, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm boundaries
      - run: pnpm env:check
      - run: pnpm format:check
      - run: pnpm lint:root && pnpm typecheck:root
      - run: pnpm turbo run typecheck lint build --continue
  test:
    runs-on: ubuntu-latest
    needs: check
    services:
      postgres:
        image: pgvector/pgvector:pg16
        env: { POSTGRES_USER: flowaid, POSTGRES_PASSWORD: flowaid, POSTGRES_DB: flowaid }
        ports: ["5432:5432"]
        options: --health-cmd "pg_isready -U flowaid" --health-interval 5s --health-timeout 5s --health-retries 12
    env:
      DATABASE_URL: postgres://flowaid:flowaid@localhost:5432/flowaid
      TYPESAFE_API_KEY: ${{ secrets.TYPESAFE_API_KEY }}   # empty on fork PRs → live smoke skips
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version-file: .nvmrc, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm test:coverage                       # vitest run --coverage (finding 22)
      - uses: actions/upload-artifact@v4
        if: always()
        with: { name: coverage, path: coverage/ }
  docker:
    runs-on: ubuntu-latest
    needs: check
    if: hashFiles('apps/api/package.json') != ''        # until WP-15/16/19 land
    strategy: { matrix: { image: [api, worker, web] } }
    steps:
      - uses: actions/checkout@v4
      - uses: docker/setup-buildx-action@v3
      - uses: docker/build-push-action@v6
        with:
          context: .
          file: docker/Dockerfile.${{ matrix.image }}
          push: false
          tags: flowaid/${{ matrix.image }}:ci
          cache-from: type=gha
          cache-to: type=gha,mode=max
  e2e:
    runs-on: ubuntu-latest
    needs: docker
    if: hashFiles('playwright.config.ts') != ''
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version-file: .nvmrc, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: cp .env.example .env && docker compose up -d --wait
      - run: pnpm exec playwright install --with-deps chromium
      - run: pnpm test:e2e
      - uses: actions/upload-artifact@v4
        if: always()
        with: { name: playwright-report, path: playwright-report/ }
      - run: docker compose logs --no-color > compose.log; docker compose down -v
        if: always()
```

Turbo cache: either `actions/cache` on `.turbo` keyed by `github.sha` with restore-keys, or
Vercel remote cache via `TURBO_TOKEN`/`TURBO_TEAM` secrets. Add branch protection requiring
`check` and `test`.

### 6. `no-dockerignore` — `COPY . .` with no `.dockerignore`

All three Dockerfiles `COPY . .` in the `build` stage. Without a `.dockerignore` the build
context includes host `node_modules/` (macOS-compiled natives that collide with the Linux
`pnpm install --offline`), `.git/`, `.env` and `.env.local` (the latter holds a live
`TYPESAFE_API_KEY` today), `docs/`, `brand/fonts/`, `dist/`, `.turbo/`. Secrets in `.env`
end up in the `build` layer and in the BuildKit cache even though the `runtime` stage only
copies `/out`. Add:

```
.git
**/node_modules
**/dist
**/.next
**/.turbo
**/coverage
**/*.tsbuildinfo
.env
.env.*
!.env.example
docs
brand/fonts
playwright-report
test-results
.claude
```

### 7. `compose-master-key-conflict` — compose config is rejected by the env schema

`docker/compose.yml` lines 27–28 set both `FLOWAID_MASTER_KEY: ${FLOWAID_MASTER_KEY:-}` and
`FLOWAID_MASTER_KEY_FILE: /data/master.key` for every service.
`packages/env/src/schema.ts:292-297` errors when `FLOWAID_MASTER_KEY` is set and
`FLOWAID_MASTER_KEY_FILE` differs from its default (`.flowaid/master.key`). So the
documented production path (`.env.example`: "Generate with openssl rand -base64 32") makes
`api`, `worker` and `worker-code` fail `loadEnv()` at boot inside compose.
Fix: relax the rule to precedence-only (docs.ts already says the env var takes precedence),
update `docs.ts` text, regenerate with `pnpm env:example`, add a `load.test.ts` case. Then
add `scripts/check-compose.test.ts` to the root Vitest project: run
`docker compose config --format json` (skip when docker is absent), and for `api`, `worker`,
`worker-code` feed `service.environment` to `safeLoadEnv()` from `@flowaid/env` — this
catches every future drift between compose and the schema.

### 8. `compose-secret-scope` — every container gets every secret

`web` and `worker-code` both have `env_file: ../.env` (compose.yml lines 166, 133). `web`
needs only `FLOWAID_API_INTERNAL_URL` and `NEXT_PUBLIC_FLOWAID_BASE_URL`; the sandbox host
`worker-code` (the container designed to survive a sandbox escape) receives
`FLOWAID_MASTER_KEY`, `FLOWAID_ADMIN_PASSWORD`, provider keys and `DATABASE_URL` with write
access. Fix: remove `env_file` from `web`; give `worker-code` an explicit environment block
without `FLOWAID_MASTER_KEY`/`FLOWAID_ADMIN_*`/provider keys (credentials are fetched via the
orchestrator per ARCHITECTURE.md plugin-host rules), add `cap_drop: [ALL]`, `pids_limit: 256`,
`deploy.resources.limits.memory` to `worker-code`, and pin `postgres`/`minio`/`redis` host
port bindings to `127.0.0.1:` so a laptop running `docker compose up` does not expose them
on the LAN.

### 9. `vendor-tarball-stage` — CODE_EXPORT.md's vendored mode has no Docker step

CODE_EXPORT.md §1: "the API image carries `/opt/flowaid/vendor/*.tgz` (built with
`pnpm pack` for every runtime package at image build time)"; WP-17b names "vendor tarball
build step in `docker/Dockerfile.api`". `Dockerfile.api` has no such stage. Add after
`build`:

```dockerfile
FROM build AS vendor
RUN set -e; mkdir -p /out/vendor; for p in workflow-core workflow-compiler workflow-runtime node-sdk \
  nodes-core providers provider-typesafe provider-openai provider-anthropic provider-ollama \
  credentials observability mcp openapi-tools sandbox workflow-sdk; do \
  pnpm --filter "@flowaid/$p" pack --pack-destination /out/vendor; done
```

and in `runtime`: `COPY --from=vendor --chown=flowaid:flowaid /out/vendor /opt/flowaid/vendor`,
`ENV FLOWAID_VENDOR_DIR=/opt/flowaid/vendor`, plus `FLOWAID_EXPORT_MODE`/`FLOWAID_VENDOR_DIR`
in `packages/env/src/docs.ts`. This only produces usable tarballs once finding 10 is done.

### 10. `exports-point-to-src` — packages publish TypeScript sources as their entry point

Every package: `"exports": { ".": "./src/index.ts" }` while `build` emits `dist/` that no
consumer references. Consequences: `pnpm deploy` (Dockerfile.api/worker) ships packages whose
entry is `.ts`; Node 24 refuses type stripping for files under `node_modules`, so
`node dist/main.js` in the runtime image will fail on `import "@flowaid/shared"`.
`pnpm pack` (finding 9) would ship the same. Turbo's `^build` dependency for `lint`,
`typecheck`, `test`, `dev` does work nobody consumes. Fix (all packages except `ui`, which
is bundled by Next/Vite):

```json
"exports": { ".": { "development": "./src/index.ts", "types": "./dist/index.d.ts", "default": "./dist/index.js" } }
```

`tsconfig.base.json` → `"customConditions": ["development"]`; root and package
`vitest.config.ts` → `resolve.conditions: ["development"]`; keep `^build` only for `build`
and `test:e2e`. Add a root test that every workspace package with a `build` script has a
`dist/index.js` `default` export condition and `files: ["dist"]`.

### 11. `turbo-config` — cache inputs miss root files; dead outputs

Dry-run shows `globalCacheInputs.files: []`. Editing `boundaries.json` or
`eslint.boundaries.js` does not invalidate cached `lint`; editing root `tsconfig.json` does
not invalidate anything. `test` declares `outputs: ["coverage/**"]` with no coverage →
warnings on every run. `dev` depends on `^build`, so `pnpm dev` first builds everything.
Fix in `turbo.json`:

```json
"globalDependencies": ["boundaries.json", "eslint.boundaries.js", "pnpm-workspace.yaml", ".npmrc", "tsconfig.json", ".nvmrc"],
"tasks": {
  "test": { "dependsOn": ["^build"], "outputs": [], "inputs": ["$TURBO_DEFAULT$", "!README.md"] },
  "test:coverage": { "dependsOn": ["^build"], "outputs": ["coverage/**"] },
  "lint": { "inputs": ["$TURBO_DEFAULT$", "!README.md"] }
}
```

and drop `^build` from `dev`/`lint`/`typecheck` once finding 10's `development` condition
exists.

### 12. `ui-package-lint-no-boundary`

`packages/ui/eslint.config.js` = `[...base, { ignores: [...] }]`. It never adds
`boundaryConfig("ui")`, so `pnpm lint` (turbo → `eslint src playground` per package) does
not enforce ui's `browserSafe` (no Node built-ins) or its allow list; only a root `eslint .`
would, and no script runs that. There is also no React lint at all
(`eslint-plugin-react-hooks`, `eslint-plugin-jsx-a11y`). Fix: add
`boundaryConfig("ui")` + `testBoundaryConfig("ui")`; add `packages/config/eslint.react.js`
(= base + `react-hooks` recommended + `jsx-a11y` recommended) and use it in ui (and later
apps/web); extend `scripts/check-boundaries.test.ts` to read every
`packages/*/eslint.config.js` and assert it references `boundaryConfig("<name>")`.

### 13. `node-version-file` and toolchain pins

No `.nvmrc`/`.node-version`; `engines.node: ">=24.0.0"` accepts 25/26 while
VERSIONS.md says Vitest 5 excludes Node 25 and Docker runs 24. `.npmrc` lacks
`engine-strict=true` and `save-exact=true` (pnpm's default save prefix is `^`, so the next
`pnpm add` breaks the exact-pin convention). Dockerfiles hard-code `pnpm@12.5.1` three
times and rely on corepack, which Node 25 no longer bundles. Fix: add `.nvmrc` (`24`) and
`.node-version` (`24`); `engines: { node: ">=24 <25", pnpm: "12.5.1" }`; `.npmrc`
`engine-strict=true`, `save-exact=true`; Dockerfiles `ARG PNPM_VERSION=12.5.1` and
`RUN npm install -g pnpm@${PNPM_VERSION}`; CI `setup-node` with `node-version-file`.

### 14. `versions-md-drift`

`docs/design/VERSIONS.md` does not list ~25 packages pinned in `packages/ui/package.json`
(`motion 13.4.1`, `@tanstack/react-table 9.2.4`, `@tanstack/react-virtual 3.14.13`,
`@codemirror/* 6.x`, `d3-scale`, `d3-shape`, `date-fns 4.4.0`, `react-resizable-panels 4.13.2`,
`happy-dom 20.14.5`, `@testing-library/*`, `vite 8.3.0`, `@vitejs/plugin-react 6.1.1`,
`fast-check 4.10.2`, `@radix-ui/react-{accordion,collapsible,slider,toggle-group}`) and lists
ones not installed (`@vitest/coverage-v8`, `@playwright/test`, `tsup`); `@types/node` is
documented as 26.6.2 but pinned at 24.13.6. Fix: add `scripts/check-versions.test.ts` (root
Vitest project) that parses the VERSIONS.md tables (including the "a 1.2.3, b 4.5.6" rows),
asserts every non-workspace dependency in every workspace `package.json` is an exact pin and,
when listed, matches; fails when an installed dependency is missing from VERSIONS.md.
Update VERSIONS.md to pass.

### 15. `security-md-wrong-vars`

`SECURITY.md` "Operating securely" names `FLOWAID_ENCRYPTION_KEY` and `FLOWAID_JWT_SECRET`;
neither exists (`packages/env/src/schema.ts` has `FLOWAID_MASTER_KEY`,
`FLOWAID_JWT_PRIVATE_KEY`/`FLOWAID_JWT_PUBLIC_KEY`). It tells reporters to use "the
repository's package.json `author`", which does not exist. Fix: rewrite with the real
variable names, link `packages/env/README.md`, give a contact (GitHub private vulnerability
reporting or an address), and add a test in `packages/env/src/docs.test.ts` that every
`[A-Z][A-Z0-9_]{3,}` token inside backticks in `README.md`, `SECURITY.md`, `docker/README.md`
that starts with `FLOWAID_`/`S3_`/`DB_` is a key of `ENV_VAR_DOCS`.

### 16. `readme-accuracy`

`README.md`: Quick start (`docker compose up`, `pnpm dev`, "open localhost:3001") cannot
work — `apps/` is empty and `docker/README.md` itself says the images "cannot be built until
those apps exist". The LangChain section describes `packages/langchain`,
`packages/nodes-langchain`, `packages/importer/src/langchain-map.ts`, `docs/langchain/`
and a boundary check "that fails the build" — none exist. The layout block lists
`importer/` (ARCHITECTURE says `importer`), omits `codegen`, `langchain`,
`nodes-langchain` and `apps/docs` (SPEC "Stack & repo"). The design-docs table omits
`CODE_EXPORT.md` and `LANGCHAIN.md`. "Checks used in CI" — there is no CI. The only runnable
surface today, the ui playground (`pnpm --filter @flowaid/ui dev`, port 5178), is not
mentioned. `db:migrate`/`db:generate` scripts target a package that does not exist. Fix: add
a "Status" table (package → exists + test count / planned WP), mark planned paths
"(planned)", add the playground section, add the two doc rows, move the LangChain section
under "Planned integrations" until the packages land, and add
`scripts/check-readme-paths.test.ts` that every backticked repo path in README.md exists or
is followed by "(planned)".

### 17. `contributing-docs`

Missing: `CONTRIBUTING.md`, a root `ARCHITECTURE.md` pointer, a node authoring guide (SPEC
"Node system": third-party nodes via npm; LANGCHAIN.md §3 plugin pattern; no `docs/guides/`
exists), `.github/ISSUE_TEMPLATE/*`, `PULL_REQUEST_TEMPLATE.md`, `CODEOWNERS`,
good-first-issue guidance, `NOTICE` (Apache-2.0; CODE_EXPORT.md ships one in exports).
Write: `CONTRIBUTING.md` (nvm/pnpm setup, `pnpm check`, how to add a package: boundaries.json

- ARCHITECTURE §1.1 + `eslint.config.js` with `boundaryConfig` + named `vitest.config.ts`,
  PR checklist, RFC process in `docs/rfcs/` for CONTRACTS changes per IMPLEMENTATION_PLAN.md
  header); `docs/guides/authoring-nodes.md` from CONTRACTS.ts §16 (`NodeDefinition`,
  `definePackage`, `"flowaid": { "package": "nodePackage", "sdk": "^1" }`, id prefix rule,
  idempotency/capabilities/credential slots, `createTestContext`/`runNode` harness, plugin
  install via `flowaid plugin add`), marked against WP-04; issue templates (bug, feature,
  good first issue) and a PR template with the `pnpm check` checklist; `NOTICE`.

### 18. `hooks-and-releases`

No git hooks, no lint-staged, no changesets, no CHANGELOG, no release workflow, no
Renovate/Dependabot. Fix: `lefthook` (`lefthook.yml`: pre-commit → prettier + eslint on
staged files; pre-push → `pnpm boundaries && pnpm typecheck`), `@changesets/cli` with
`privatePackages: { version: true, tag: true }` and a single fixed version group for all
`@flowaid/*`, `.github/workflows/release.yml` (changesets/action → tag → build and push
`ghcr.io/<org>/flowaid-{api,worker,web}:<version>` with OCI labels), `renovate.json`
(`npm` + `docker` managers, `pinDigests: true`, weekly lockfile maintenance, grouped
`@langchain/*`, `@radix-ui/*`, `@codemirror/*`).

### 19. `root-scripts`

Add: `check` (`pnpm boundaries && pnpm env:check && pnpm format:check && pnpm lint:root && pnpm typecheck:root && pnpm turbo run typecheck lint test build`),
`test:coverage`, `playground` (`pnpm --filter @flowaid/ui dev`), `docker:build`, `docker:up`
(`docker compose up -d --wait`), `docker:down`, `docker:logs`, `deps:outdated`. Make `clean`
not delete root `node_modules` (`clean:all` for that). Remove or guard `db:*` until
`@flowaid/database` exists.

### 20. `gitignore-editor`

`.claude/` is untracked and unignored (`confidenz-latest.json` changes every minute;
`settings.local.json` is ignored only by this machine's global gitignore). Add
`.claude/*` + `!.claude/settings.json`, `.vscode/*` + `!.vscode/{settings,extensions}.json`,
`.idea/`, `.eslintcache`, `*.tgz`, `vite.config.ts.timestamp-*`. Add
`.vscode/settings.json` (`eslint.useFlatConfig`, prettier as default formatter,
`typescript.tsdk`) and `.vscode/extensions.json`. `.editorconfig`: `[*.md]
trim_trailing_whitespace = false`. Note: `.env.local` (mode 0644) holds a live TypeSafe key;
nothing in the repo reads it (compose reads `.env`, `packages/env` has no dotenv) — document
`node --env-file=.env` as the dev convention.

### 21. `tsconfig-presets`

`packages/config/tsconfig.node.json` does not exclude `**/*.test.ts` (apps built with it
will emit tests into `dist/` and into the Docker images). `tsconfig.react.json` hard-codes
the `next` plugin so `packages/ui` has to override `plugins: []`; split into
`tsconfig.react.json` (Vite/React, `jsx: react-jsx`) and `tsconfig.next.json`. Every package
repeats `rootDir/outDir/types` that the preset already sets; `workflow-core/tsconfig.json`
uses `rootDir: "."`. Base `lib`/`target` are ES2023 while Node 24 supports ES2024
(`Object.groupBy`, `Promise.withResolvers`). Fix the presets, remove the per-package
duplicates.

### 22. `coverage-and-e2e-scaffold`

IMPLEMENTATION_PLAN.md requires 90 % line coverage on core packages; `@vitest/coverage-v8`
is not installed, no thresholds exist, `turbo.json` expects `coverage/**`. WP-00 lists
`playwright.config.ts`; it does not exist and `test:e2e` runs nothing. `packages/ui` and
`workflow-core` `vitest.config.ts` have no `name`, so `vitest --project ui` cannot target
them. Fix: add `@vitest/coverage-v8@4.1.11`, root `coverage: { provider: "v8", reporter:
["text", "lcov"], include: ["packages/*/src/**"], exclude: ["**/*.test.*", "**/gallery.tsx"] }`,
per-package `thresholds` (90 lines/branches on workflow-core now), `test:coverage`
scripts; add `playwright.config.ts` + `@playwright/test@1.63.0` with `webServer` against
`docker compose` and one smoke spec, gated in CI as in finding 5; name the two projects.

### 23. `docker-image-pinning`

`minio/minio:latest`, `minio/mc:latest` (MinIO removed features from community builds in
2025 and `mc` syntax has changed), `redis:7-alpine`, `pgvector/pgvector:pg16`, `node:24-alpine`
are all floating. Pin to dated tags with digests and let Renovate (finding 18) bump them.

### 24. `dockerfile-consolidation`

The three Dockerfiles duplicate the `deps` stage (corepack, fetch, cache mount). Merge into
one `docker/Dockerfile` with targets `api`, `worker`, `web` (`compose.yml` `build.target`),
share `ARG PNPM_VERSION`, add OCI labels (`org.opencontainers.image.{source,revision,version}`
via build args), and `--platform` matrix (`linux/amd64,linux/arm64`) in the release
workflow. Keep: non-root user, tini, healthchecks, `worker-code` read-only root.

### 25. `env-defaults`

`.env.example` (generated from `packages/env/src/docs.ts`) sets `HOST=0.0.0.0` as the
default for local development, binding the API to every interface; compose already
overrides `HOST`, so the schema default can be `127.0.0.1`. Also document in
`packages/env/README.md` which file is read where (`docker compose` → `.env`; local dev →
`node --env-file=.env`; `.env.local` is read by nothing).

## Not reported as findings

- `pnpm-workspace.yaml` `minimumReleaseAgeExclude` without an explicit `minimumReleaseAge`:
  pnpm 12 applies a default policy (install prints "Lockfile passes supply-chain policies"),
  so the list is live; making the age explicit is optional.
- `packages/config/eslint.base.js` `tsconfigRootDir: import.meta.dirname` (points at
  `packages/config`): `projectService` resolves per-file, root and package lint both work.
- The rest of the platform (apps, compiler, runtime, database) not existing — backlog
  reviewer's scope.
