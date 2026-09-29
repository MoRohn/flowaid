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
administrator and serves the web app at <http://flowaid.localhost:3000> and the API beside it on
port 3001 (when another app holds either port, it moves to the next free one and says where).
`pnpm start -- --help` lists every option.

## Build your first workflow

The quickest first run: _Templates → Message triage (starter) → Use template_, type a message in
the Run tab and press **Run draft**. It needs only TypeSafe: either `TYPESAFE_API_KEY` in
`.env.local` or a TypeSafe credential. The Output tab says whether the run completed, and the
trace shows each decision's probabilities.

## Start from a business flow

_Templates → Business flows_ (or _New workflow → From a template_) has four complete workflows
for everyday operations. Each runs end to end with only the TypeSafe key:

| Flow                     | Area             | What it does                                                                                                        | Settings you can change                   |
| ------------------------ | ---------------- | ------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| Expense approval         | Finance          | Checks a claim against the spending policy; approves small compliant claims, sends the rest to a manager to approve | `autoApproveLimit`, `receiptRequiredOver` |
| Sales lead qualification | Sales            | Scores an inbound lead 0–100 and routes it to sales, nurture, support or discard, with the next step                | `salesScore`                              |
| IT help desk routing     | IT operations    | Sets category, priority (P1–P4), team and response time; escalates security incidents                               | `majorIncidentUsers`                      |
| Refund request handling  | Customer service | Checks the refund policy and fraud risk; refunds, declines or sends to an agent, with the reply to the customer     | `autoRefundLimit`, `returnWindowDays`     |

Creating one gives you your own workflow. Click the empty canvas to open the workflow panel:
rename it, describe it, and change its settings (limits, windows, scores), which every step reads
as `$vars.<name>`. Select any step to change its wording, options or logic, and add or remove
steps as usual. Approvals wait under _Human tasks_ until someone answers them.

To build one yourself:

1. **Start a workflow**: _Workflows → New workflow → Blank_, or start from a template. Each template
   card says what it needs (keys, MCP servers, documents) and whether this workspace has it. If you
   have an existing flow export, choose _Import an external flow export_ instead (see
   [Importing external flows](importing.md)).
2. **Add a decision**: press **Add node** and add **Boolean** from _Decision_. Connect the input's
   `message` port to its `state` input, and write the question in _Instructions_. In prompt and
   template fields, type `{{` to insert a value such as `{{ start.message }}`.
3. **Give the step its key**: select the node and use **Add a key for this step** under
   _Credentials_. When the server already has that provider's key (for example
   `TYPESAFE_API_KEY` in `.env.local`), the key is added as optional and runs use the server's
   key. Otherwise add the key under _Credentials_ and bind it to the secret for each environment
   in the workflow's _Settings → Secrets_.
4. **Run the draft** from the Run tab. Anything in the way (an empty required field, a missing
   key, a problem in the draft) is listed there with a way to reach it. Then **Publish**.

## Call it

Every published workflow is an HTTP endpoint, a CLI command and an MCP tool:

```sh
curl -X POST http://flowaid.localhost:3001/v1/workflows/<workflow-id>/run \
  -H "Authorization: Bearer $FLOWAID_API_KEY" -H "Content-Type: application/json" \
  -d '{"input":{"message":"Refund please"}}'

pnpm flowaid workflow run <workflow-id> --input '{"message":"Refund please"}' --watch
```

See the [TypeScript SDK](../../../packages/workflow-sdk/README.md) and the
[command line](../../../packages/cli/README.md) for the clients.
