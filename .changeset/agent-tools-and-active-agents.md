---
"@flowaid/nodes-core": minor
"@flowaid/worker": minor
"@flowaid/api": minor
"@flowaid/web": minor
"@flowaid/database": minor
"@flowaid/cli": minor
"@flowaid/workflow-sdk": minor
---

Built-in agent tools, and agents you can switch on and off.

- Three tools every agent can use without connecting anything: `calculator` (exact arithmetic,
  parsed rather than evaluated), `current_time` (date, time, weekday and offset in any IANA time
  zone) and `web_fetch` (a public web page's title and main text as Markdown, through the guarded
  fetch, GET only, 15 s, 2 MB, 20 000 characters at most). Their schemas use only `type`,
  `properties`, `required` and `description`, which every provider's function calling accepts, and
  a bad argument comes back as a message the model can act on. They are in every workspace's tool
  catalog; the New agent dialog lists them under "Built into FlowAId", apart from your own tools,
  with a note on what reading the web means for private data.
- Agents have an Active switch on the Agents page. An active agent appears by name in every
  workflow's Add node (Agent group); adding it creates an Agent step that uses the agent and
  overrides none of its settings. Switching it off hides it there without breaking the steps that
  already use it. `GET /v1/agents?active=true|false` filters by it, and `PATCH /v1/agents/:id`
  takes `active`. New agents start active; migration `0011_agent_active` adds the column.
