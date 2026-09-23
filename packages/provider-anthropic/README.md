# @flowaid/provider-anthropic

Claude through the Anthropic Messages API as a flowaid `GenerationProvider`
(ARCHITECTURE.md §6.6). `registry.register(anthropicFactory())`; credential type
`anthropic.api_key`.

- **Streaming:** `message_start`, `content_block_*` (text, thinking, tool-input JSON),
  `message_delta` and `error` events become text, thinking, tool-call, usage and done chunks.
- **Tools:** `tools` / `tool_use` / `tool_result`; tool choice `auto`, `any`, `none` or a named
  tool.
- **Structured output:** a forced `respond` tool whose `input_schema` is the requested schema;
  its input is the result (`GenerationResult.structured`).
- **Prompt caching:** system prompts over ~1k tokens are marked `cache_control: ephemeral`;
  cache reads and writes are counted in `inputTokens` and priced at their own rates.
- **Errors:** 401 → credential, 429 → rate limited (Retry-After), 529/503 → overloaded,
  other 5xx retryable, 4xx not, context length → `BoundsExceededError('maxTokens')`.

Fixtures are constructed from Anthropic's documented event stream (no live key was available)
and say so; re-record them when a key is configured.
