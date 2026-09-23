# @flowaid/provider-ollama

Local models through Ollama as flowaid generation and embedding providers
(ARCHITECTURE.md §6.6). `registry.register(ollamaFactory())` and `ollamaEmbeddingFactory()`;
credential type `ollama.host` (`host`, optional bearer `token` for a protected proxy) or none for
http://localhost:11434.

- `/api/chat` with NDJSON streaming, `format` (JSON Schema) for structured output, tools with
  object arguments, options (`temperature`, `top_p`, `num_predict`, `stop`, `seed`).
- `/api/embed` for embeddings, `/api/tags` for discovery.
- Local inference costs nothing: `costUsd` is 0 with no price snapshot.

Fixtures are constructed from Ollama's documented stream format (Ollama was not installed when
the package was written) and say so; re-record them against a local server.
