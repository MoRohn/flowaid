# @flowaid/provider-openai

Generation and embedding providers for OpenAI and every OpenAI-compatible endpoint, as registry
factories over the shared streaming client in `@flowaid/providers` (ARCHITECTURE.md §6.6).

```ts
for (const factory of openaiFactories()) registry.register(factory);
await registry.generation({ provider: "openai", model: "gpt-5.4-mini" }, ctx);
await registry.generation({ provider: "google", model: "gemini-3.5-flash" }, ctx);
await registry.generation(
  { provider: "openai-compatible", model: "llama-4" },
  { ...ctx, options: { preset: "groq" } },
);
```

| Factory id          | Endpoint                                                                             | Credential type                      |
| ------------------- | ------------------------------------------------------------------------------------ | ------------------------------------ |
| `openai`            | api.openai.com (`max_completion_tokens`, organization)                               | `openai.api_key`                     |
| `google`            | Gemini's OpenAI-compatible endpoint, priced from `google`                            | `google.api_key`                     |
| `openai-compatible` | presets `groq`, `mistral`, `xai`, `openrouter`, `together`, `vllm`, or any `baseUrl` | `openai.api_key` (optional for vLLM) |

Each id has a generation and an embedding factory. Streaming, tool calls assembled by index,
strict JSON-schema output, cached-token usage, catalog pricing and the error taxonomy
(context-length errors become `BoundsExceededError('maxTokens')`) come from the shared client.
Gemini's compatible endpoint does not stream thinking deltas; a native Google provider is a
later item.

Fixtures are constructed from the vendors' documented streaming format (no live key was
available when the package was written) and say so; re-record them when a key is configured.
