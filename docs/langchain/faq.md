# FAQ

**Do I need LangChain to use FlowAId?** No. The core never imports it, and every core node,
provider and template works without it. The LangChain nodes are a bundled plugin you can disable.

**Why not build workflows as LangChain chains?** FlowAId's definition format, compiler and event
log are what make runs typed, checkable, replayable and evaluable. LangChain is excellent
plumbing for generation and retrieval, so it runs inside nodes — its abstractions do not leak into
the definition, the plan or the API.

**Which vector databases work?** The workspace store (durable, up to 5,000 chunks), Qdrant and
Pinecone today, through the `vector_store` and `retriever` nodes.

**Can a LangChain app call a FlowAId workflow?** Yes: `workflowAsLangChainTool` turns a workflow
into a LangChain tool, against the API or an exported code package.

**Are LangChain calls traced and billed?** Yes. Model calls go through FlowAId providers or
report through the callback handler, so tokens, cost and bounds apply as for any node.
