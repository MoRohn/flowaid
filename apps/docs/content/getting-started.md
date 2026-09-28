# Getting started

## Prerequisites

- Node.js 24 or later and pnpm 12 (`corepack enable`).
- Docker, for PostgreSQL (with pgvector) and Redis. You can point FlowAId at your own PostgreSQL
  16 instead with `pnpm start --database-url postgres://…`.
- A TypeSafe API key for decision nodes, and keys for any model providers you use.

## Start the platform

```sh
git clone https://github.com/MoRohn/flowaid.git
cd flowaid
pnpm install
pnpm start
```

`pnpm start` checks your machine, starts the databases, runs the migrations, creates the first
administrator and serves the web app and the API. `pnpm start -- --help` lists every option.

## Build your first workflow

1. **Add your TypeSafe key as a credential**: _Credentials → New credential → TypeSafe API key_.
2. **Start a workflow**: _Workflows → New workflow → Blank_, or start from a template. If you have
   an existing flow export, choose _Import an external flow export_ instead (see
   [Importing external flows](importing.md)).
3. **Add a decision**: press **+** and add **Boolean** from _Decision_, connect the input's
   `message` port to its `state` input, and write the question in _Instructions_.
4. **Bind the secret**: _Settings → Secrets_ maps the node's `TYPESAFE_API_KEY` slot to your
   credential for each environment.
5. **Run the draft** from the Run tab, then **Publish**.

## Call it

Every published workflow is an HTTP endpoint, a CLI command and an MCP tool:

```sh
curl -X POST http://flowaid.localhost:3000/v1/workflows/<workflow-id>/run \
  -H "Authorization: Bearer $FLOWAID_API_KEY" -H "Content-Type: application/json" \
  -d '{"input":{"message":"Refund please"}}'

pnpm flowaid workflow run <workflow-id> --input '{"message":"Refund please"}' --watch
```

See the [TypeScript SDK](../../../packages/workflow-sdk/README.md) and the
[command line](../../../packages/cli/README.md) for the clients.
