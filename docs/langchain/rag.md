# Retrieval (RAG)

A retrieval workflow is explicit FlowAId steps, so every stage is visible in the trace and can be
evaluated separately:

1. **Load** — `document_loader` reads content given as input, web pages, sitemaps or a GitHub
   repository.
2. **Split** — `text_splitter` cuts documents into chunks.
3. **Index** — `vector_store` with `operation: upsert` embeds and stores them. Ids are
   deterministic, so re-ingesting the same document replaces its chunks.
4. **Retrieve** — `retriever` finds the relevant chunks and builds a `context` block.
5. **Answer** — `chat` answers from `{context}` and `{question}`.

The **Knowledge assistant (LangChain RAG)** template adds FlowAId's decision layer around this:
TypeSafe judges whether the retrieved passages answer the question, checks the answer's safety
and groundedness, and a confidence gate sends weak answers to a reviewer.

Indexing on every run is fine for small, changing corpora. For a stable corpus, move steps 1–3
into their own workflow (run on a schedule or a webhook) and keep the answering workflow to
steps 4–5.
