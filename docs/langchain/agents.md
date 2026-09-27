# Agents

`@flowaid/nodes-langchain.agent` runs a LangGraph ReAct agent inside one node. The agent's tools
are workflow tools (HTTP, MCP, OpenAPI operations, other workflows) listed in the node's `tools`
configuration, each with an approval policy.

**Bounds.** The node stops the agent at `maxSteps`, `maxToolCalls`, `maxTokens`, `maxCostUsd` or
its timeout, whichever comes first. The compiler requires a spend bound (`E_AGENT_UNBOUNDED`):
set `maxCostUsd` or `maxTokens` on the node's policy, or `execution.maxCostUsd` on the workflow.

**Approvals.** A call to a tool that needs approval suspends the run and creates a human task.
The agent's conversation is the durable suspend state, so the run resumes exactly where it
stopped after the reviewer answers — even after a worker restart.

**Tracing.** Every model call and tool call appears in the run's trace with its cost; tool calls
are `TOOL_CALLED` / `TOOL_RETURNED` events like any other tool node.
