# RFC-0001: The `jobs` and `maintenance` queues

- Status: accepted (2026-09-27)
- Raised by: the 2026-09-22 design review — `export-job-artifact-model` (the code export needs a background job whose result is an artifact) and `retention-job-and-settings`
- Implemented by: P4-04 (export), P3-03 (maintenance)
- Affects: `CONTRACTS.ts` §17 (`QueueName` gains `'jobs'` and `'maintenance'`; `Job` gains `export.package`, `retention.sweep`, `partition.ensure`, `draft_versions.gc`); `@flowaid/workflow-core` 0.3.2 → 0.3.3

## Motivation

`POST /v1/workflow-versions/:versionId/export/package` answers `202 { job_id }` and the zip is built off the request path (CODE_EXPORT.md §4). The API records the request in the `jobs` table and the worker needs a queue and a typed payload to pick it up. Retention, partition creation and draft-version garbage collection are periodic maintenance that should not compete with run execution.

## Change

- `QueueName`: `| 'jobs' | 'maintenance'`.
- `Job`:
  - `{ type: 'export.package'; jobId; workspaceId; workflowId; versionId: string | null; draftRevision?; mode: 'npm' | 'vendored'; includeSampleFromRunId?; includeRecordedRunId?; requestedBy }` on `jobs`;
  - `{ type: 'retention.sweep'; at }`, `{ type: 'partition.ensure'; monthsAhead }`, `{ type: 'draft_versions.gc' }` on `maintenance`.

Additive: new union members only.

## Compatibility

- Stored data: none (the `jobs` table already exists).
- Wire: queue payloads only; an older worker logs the new types as unhandled.

## Tests

- `@flowaid/codegen`: bundle generation, round trip, a generated package that runs.
- `apps/worker`: the `export.package` consumer writes a `kind='export'` artifact and completes the `jobs` row.
- `apps/api`: 202 → completed → download with `attachment`.
