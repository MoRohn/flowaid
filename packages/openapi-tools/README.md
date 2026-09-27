# @flowaid/openapi-tools

OpenAPI 3.0 / 3.1 as flowaid tools (ARCHITECTURE.md §10.3).

- **`parseOpenApi({ url } | { text, format })`.** JSON, or YAML read with the core schema only (no
  custom tags or merge keys). Documents are capped at 2 MiB, 500 operations and schema depth 32.
  External `$ref`s are resolved before the parser runs, through the caller's fetch: at most 10
  documents, 3 hops and 5 MiB each, never to private addresses (`E_OPENAPI_EXTERNAL_REF`); they
  are inlined so `@readme/openapi-parser` runs with external and file resolution off. Servers
  (document, path and operation level, with variables resolved) that point at private addresses
  are rejected (`E_TOOL_SERVER_PRIVATE`). 3.0 `nullable` is normalised to a `null` type.
- **`operationsToTools(doc, { toolsetId })`.** One `ToolDefinition` per operation.
  `inputSchema = { path, query, headers, body }` and `outputSchema = { status, body }` come from the
  2xx JSON response. Idempotency follows the method: GET/HEAD are safe, PUT/DELETE are keyed, and
  POST/PATCH are none unless `x-idempotent: true`. The capability comes from
  `x-flowaid-capability` or `<toolset>.<read|write>`. Security schemes (bearer, basic, apiKey,
  OAuth 2 client credentials) are resolved per operation.
- **`coerceArgs`.** Lenient conversion of model-produced arguments (`"42"` → 42, `"true"` → true,
  scalars → arrays, JSON strings → objects), with every conversion reported.
- **`executeOperation`.** Validates arguments after coercion. It templates paths with
  `encodeURIComponent`, serialises queries (form, deepObject, delimited) and builds
  JSON / form / multipart / text bodies. It applies the credential, including the
  client-credentials grant with a token cache, and forwards `Idempotency-Key` for keyed
  operations. It refuses `Host`, `Content-Length`, an undeclared `Authorization` and CR/LF header
  values, and re-checks the server address. Responses of 400 and above map to
  `ToolExecutionError`, which is retryable for 408, 425, 429 and 5xx.
