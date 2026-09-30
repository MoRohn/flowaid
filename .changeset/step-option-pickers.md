---
"@flowaid/web": minor
"@flowaid/nodes-core": minor
---

Pickers for steps that point at something in the workspace.

- The Agent step's preset is chosen by name from the workspace's agent presets instead of typed
  as an id.
- MCP tool and MCP prompt steps list the connected servers, then the chosen server's tools or
  prompts; OpenAPI steps list the imported toolsets, then the chosen toolset's operations. A
  list that depends on another field says to choose that one first, and a list that fails to
  load says why and can be refreshed.
