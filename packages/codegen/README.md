# @flowaid/codegen

"Download code" (CODE_EXPORT.md): a workflow as typed code and as a runnable package. The API
produces the single-file `ts` export with it, and the worker's `export.package` job builds the
zip.

- **`generateWorkflowTs(def)`.** `src/workflow.ts` over the `@flowaid/workflow-sdk` builders
  (API.md §8.1), formatted with Prettier. It is total over `WorkflowDefinitionSchema`: the
  document is parsed first, every field except schema defaults is emitted, and every binding
  position uses the binding builders. Strings are emitted as JSON literals, so a document can
  never inject code. `assertRoundTrip` evaluates the module against the real builders and throws
  `CodegenRoundTripError` (`INTERNAL`, `details.reason: "CODEGEN_ROUNDTRIP"`) unless the result
  hashes like the source. A fast-check property over random definitions covering every node and
  binding kind checks this, alongside goldens of the fixtures (`golden/`).
- **`buildExportBundle(input)` → `ExportBundle.toZip()`.** The package: `workflow.json`,
  `workflow.plan.json`, `src/{workflow,flow,nodes,providers,sandbox,run,serve,client,validate}.ts`,
  `inputs/example.json`, a Vitest suite on fake providers (plus a replay of a recorded run when
  one is included), `Dockerfile`, `.env.example`, `README.md`, `LICENSE` and `NOTICE`. The
  static sources are real TypeScript in `templates/*.tmpl`.
  - Dependency modes: `npm` pins `PACKAGE_VERSIONS`. `vendored` ships the `pnpm pack` tarballs
    of `packageClosure(plan)` with `vendor/SHA256SUMS` and `tests/vendor-integrity.test.ts`, and
    pins every `@flowaid/*` dependency to `file:./vendor/…` through `pnpm.overrides`.
  - Redaction: run data is scrubbed again. Values marked `x-dataClass: pii | sensitive` and
    `$redacted` stubs become schema-generated placeholders. So does the output of every node
    fed by personal data (propagated over the plan's data edges). Recordings leave out
    `privacy.sensitive` nodes, node inputs and provider `raw` payloads. The README lists every
    placeholder.
- **`packageClosure(plan)`.** The `@flowaid/*` packages the flow needs: the embedded runtime,
  the `provider-*` packages of its model refs, `mcp`, `openapi-tools` and `sandbox` by node
  type, and the LangChain packages when used. It is closed over their dependencies.
- **`createZip` / `readZip`.** A deterministic, dependency-free zip writer and reader.

`src/package.run.test.ts` writes a generated package to disk with its dependencies linked to
this repository's packages, then checks four things. The runner executes the workflow on the
package's fake providers. `pnpm validate` passes. The sources typecheck under strict `tsc`. The
package's own `pnpm test` passes, including the replay. A tampered vendored tarball fails
`vendor-integrity.test.ts`.
