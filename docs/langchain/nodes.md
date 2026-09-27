# Nodes

Every node id carries the package prefix, e.g. `@flowaid/nodes-langchain.chat`.

| node              | what it does                                                                                                                                                                                                            |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `chat`            | A prompt template (`{variable}` placeholders filled from the `variables` input, optional `history`) run through the node's model; streams text, returns structured output with `outputSchema` and requested tool calls. |
| `runnable`        | A registered LCEL runnable (`registerRunnable`) with typed input and output, the node's model, embeddings and tools, traced and bounded.                                                                                |
| `agent`           | A LangGraph ReAct agent over workflow tools, bounded by steps, tool calls, tokens, cost and time; tools that need approval pause the run for a person. See [Agents](agents.md).                                         |
| `document_loader` | Text, Markdown, JSON, JSON Lines, CSV and HTML content, web pages, sitemaps and GitHub repositories.                                                                                                                    |
| `text_splitter`   | Recursive character, character, Markdown and code splitting, with chunk provenance.                                                                                                                                     |
| `embed`           | Texts or documents through the node's embedding model.                                                                                                                                                                  |
| `vector_store`    | Upsert, query and delete against the durable workspace store (up to 5,000 chunks), Qdrant or Pinecone.                                                                                                                  |
| `retriever`       | Similarity, MMR, multi-query or hybrid (vector recall re-ranked with BM25) retrieval; returns documents and a numbered, citable `context` block.                                                                        |
| `output_parser`   | JSON (validated against a schema), lists, numbers and booleans, with an optional repair loop through a chat model.                                                                                                      |

Their configuration uses the standard inspector widgets (model, template, schema, key-value), so
the builder needs nothing special to edit them. The node reference in the docs site lists every
node's ports and configuration fields, generated from the manifests.
