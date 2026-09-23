# @flowaid/workflow-compiler

Turns a `WorkflowDefinition` into an immutable, content-hashed `ExecutionPlan`, or explains
precisely why it cannot. The same compiler runs in the browser (canvas diagnostics), the API
(save and publish), the worker (plan re-check) and the CLI, so they can never disagree.

Pure, synchronous and deterministic. Browser-safe: no Node built-ins; depends on
`@flowaid/workflow-core`, `@flowaid/shared`, `ajv` and `zod`. Design:
[ARCHITECTURE.md §4](../../docs/design/ARCHITECTURE.md).

## Usage

```ts
import { compile } from "@flowaid/workflow-compiler";

const result = compile(definition, {
  catalog, // NodeCatalog: the node manifests of the workspace
  level: "publish", // "draft" (default) or "publish"
  resolveTool, // MCP / OpenAPI / workflow tool signatures, when the definition uses them
  resolveSubflow, // child workflow signatures
  providers, // configured providers and models (enables availability checks)
  boundSecrets, // secrets bound in the target environment
});

if (result.ok) {
  result.plan.planHash; // sha256 of the canonical plan
  result.diagnostics; // warnings and infos
} else {
  result.diagnostics; // at least one error, each with a location and often a quick fix
}
```

| Export                               | Purpose                                                                      |
| ------------------------------------ | ---------------------------------------------------------------------------- |
| `compile(definition, options)`       | Definition → `{ ok, plan, diagnostics }`                                     |
| `validate(definition, options)`      | Only the diagnostics                                                         |
| `checkBinding(def, target, binding)` | The canvas's single-binding check (`isValidConnection`, inspector edits)     |
| `diff(a, b)`                         | `WorkflowDiff`: added, removed and changed nodes and edges, section patches  |
| `migrateDefinition(def, catalog)`    | Moves task nodes along their manifests' declared migration chains            |
| `verifyPlan(plan, def, options)`     | The worker's re-check: plan intact and still what the definition compiles to |
| `COMPILER_VERSION`                   | Recorded in every plan; bump it when plan output changes                     |

## Passes

| #   | Pass               | Finds                                                                                  |
| --- | ------------------ | -------------------------------------------------------------------------------------- |
| 1   | Schema             | Documents that are not a `WorkflowDefinition`                                          |
| 2   | Catalog and config | Unknown types and versions, invalid config, port rules, tool signatures                |
| 3   | Structure          | Ids, input/output nodes, containers, edges, credentials, decision and human configs    |
| 4   | Bindings           | Templates, expressions and references, resolved with scope rules and typed             |
| 5   | Dependency, guards | Cycles, reachability, guards, exclusive control groups, conditional data, joins, loops |
| 6   | Types              | Every binding against the port it feeds (`isSubschema`)                                |
| 7   | Environment        | Provider and model availability, secret bindings, unused declarations, cost bound      |
| 8   | Emit               | Policies, redaction rules, batch groups, scopes in topological order, `planHash`       |

Errors stop compilation after their group (1; 2–3; 4–6; 7–8). Warnings and infos never block
publishing. The compiler owns 94 of the 96 diagnostic codes (the other two belong to
evaluation-gated publish and the importer); `fixtures/diagnostics/codes.json` shows one real
example of each.

## Guarantees

- **Deterministic.** Same definition and options ⇒ same plan, byte for byte.
- **Key-order independent.** The canonical definition (object keys in code-point order) is
  compiled, so documents with the same `definitionHash` compile to the same `planHash`.
  Postgres `jsonb` reorders keys; the worker's re-check still passes.
- **Sound pruning.** Guards are DNF over `(node, port)` literals with contradiction, subsumption
  and family-cover simplification, bounded to 64 clauses (wider guards become "always", which
  loses precision in diagnostics, never correctness at run time).
- **No code execution.** Only JSON manifests are read. Node migrations that rewrite config are
  supplied by the caller.

## Tests

```sh
pnpm --filter @flowaid/workflow-compiler test
```

- `golden.test.ts`: the reference workflow compiles to the checked-in plan in
  `workflow-core/fixtures/plans/`, byte for byte.
- `demos.test.ts`: the three demo templates compile with zero errors; plans and diagnostics
  are snapshots in `fixtures/` (regenerate with `vitest -u` after a reviewed change).
- `codes.test.ts`: one case per diagnostic code.
- `determinism.test.ts`: property tests over shuffled key orders.
- `guards.test.ts`, `semantics.test.ts`, `api.test.ts`: the guard algebra, control-flow
  semantics and the public API.
- The repository's browser-bundle check compiles the reference workflow under happy-dom and
  in a realm with only Web globals.
