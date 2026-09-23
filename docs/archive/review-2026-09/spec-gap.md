## Verification: demo-templates-unbuildable (verdict: stands, severity high)

Checked 2026-09-22.

- `packages/workflow-core/fixtures/github-issue-triage.json:233` — node `similar` is `flowaid.retrieval.retriever` with `config.sourceId` = hard-coded uuid (line 237). Retrieval nodes are not in WP-12's file list (IMPLEMENTATION_PLAN.md:83) and are scheduled under WP-25, Wave 6 (line 163). WP-12 "the three templates compile with zero errors" (line 84) therefore cannot hold against the core catalog for demo 2.
- Hard-coded MCP `serverId` uuids: `github-issue-triage.json:306,359`, `support-triage.json:264`. `mcp_servers` rows are workspace-scoped, so a seeded template (`seed_templates.ts`, DATABASE.md:722) can never carry a valid id.
- ARCHITECTURE.md:857,927,934,942 shows `<mcp server uuid>` / `<knowledge source uuid>` / `<github mcp uuid>` placeholders — the design acknowledges the binding but never specifies it.
- API.md:175: `POST /v1/templates/:id/instantiate { name? }` — no resource-binding parameter. No `requiredResources` or sentinel concept anywhere in docs/design or packages/workflow-core/src (grep empty).
- `CompileOptions.resolveTool` exists (CONTRACTS.ts:1656, plan.ts:289) so a stub-driven CI compile is feasible; nothing specifies it.
- Current fixture tests (`fixtures.test.ts`) only parse/round-trip; they do not compile, so the gap is currently invisible to CI.
