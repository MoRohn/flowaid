# Providers

## LangChain models inside FlowAId

`LangChainGenerationProvider` makes any LangChain chat model a FlowAId `GenerationProvider`:
streaming chunks, tool calls through `bindTools`, structured output through
`withStructuredOutput`, token usage (cache reads included), the node's abort signal, pricing from
the model catalog, and vendor errors mapped onto FlowAId's error taxonomy (credential, rate-limit
with `Retry-After`, overload, bounds, cancellation). `LangChainEmbeddingProvider` does the same
for `Embeddings`, and `LangChainDecisionProvider` produces typed decisions from any LangChain
model with the same rules as FlowAId's LLM decision provider.

The node package registers them as providers with ids `langchain:<vendor>`:

| provider id           | kinds                  | credential type     |
| --------------------- | ---------------------- | ------------------- |
| `langchain:openai`    | generation, embeddings | `openai.api_key`    |
| `langchain:anthropic` | generation             | `anthropic.api_key` |
| `langchain:ollama`    | generation, embeddings | `ollama.host`       |

A model reference `{ "provider": "langchain:openai", "model": "gpt-4.1-mini" }` then works in any
node that takes a model. The vendor clients receive the worker's SSRF-guarded fetch, so outbound
calls follow the same network policy as every other node.

## FlowAId models inside LangChain

`FlowaidChatModel` is a LangChain `BaseChatModel` over a FlowAId provider — normally the node's
`ctx.providers.generation(...)`. LCEL chains and LangGraph agents that run inside a node therefore
use the workspace's credentials, generation failover, pricing and tracing. `FlowaidEmbeddings`
is the embeddings counterpart.

```ts
import { FlowaidChatModel } from "@flowaid/langchain";

const model = new FlowaidChatModel({ provider: ctx.providers.generation(config.model) });
const answer = await prompt.pipe(model).invoke({ question });
```
