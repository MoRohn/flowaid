# Introduction

FlowAId is a self-hosted platform for building, running and evaluating AI agents and workflows.
Every workflow is a typed document that the compiler checks before it runs, every run is
durable and replayable, and every decision a model makes is a typed, inspectable result with the
evidence behind it.

## Where to start

- [Getting started](getting-started.md) takes a fresh clone to a running workflow.
- [Self-hosting with Docker](../../../docker/README.md) deploys the platform with Docker Compose.
- [Node reference](/nodes) lists every node in the catalog with its ports and configuration.
- [HTTP API reference](/reference/api) lists every operation; each one is also a CLI command.
- [Importing external flows](importing.md) brings existing agent and chat flow exports across,
  with a migration report of what mapped and what needs attention.
- [LangChain](../../../docs/langchain/overview.md) covers the optional LangChain integration.

## Concepts

- **Workflows** are graphs of typed nodes. Data ports carry JSON validated against schemas;
  control ports decide what runs next. The compiler reports problems with stable diagnostic codes.
- **Decisions** are TypeSafe calls that return typed results (boolean, choice, score, router and
  more) with confidence and evidence. See [decision contracts](../../../docs/jev/overview.md).
- **Runs** are durable: the worker checkpoints every step, so runs survive restarts, wait for
  people or events, and can be replayed.
- **Versions and environments**: publishing freezes a version; deployments pin versions to
  `dev`, `staging` and `prod`.
- **Code export**: any version downloads as a runnable code package.

## This site

These pages are generated from the repository: the guides, the design documents, the node
manifests and the OpenAPI document. Run `pnpm --filter @flowaid/docs build` to write the site to
`apps/docs/dist`, and `pnpm docs:check` to verify every page and link.
