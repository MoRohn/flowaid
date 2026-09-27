# Callbacks and tracing

`FlowaidCallbackHandler` connects LangChain's callbacks to the node that runs them:

| LangChain activity                   | in the FlowAId run                                               |
| ------------------------------------ | ---------------------------------------------------------------- |
| streamed tokens                      | `GENERATION_DELTA` events (live in the builder and trace viewer) |
| model, tool, retriever calls         | log entries on the node (prompts redacted and truncated)         |
| token usage                          | metric events, counted against the node's budget                 |
| exceeding `maxTokens` / `maxCostUsd` | the handler aborts the runnable with a bounds error              |

Nodes in `@flowaid/nodes-langchain` attach the handler automatically; plugin authors running
their own runnables use `callbackSinkFromContext(ctx)` to build one.
