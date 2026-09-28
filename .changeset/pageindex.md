---
"@flowaid/api": minor
"@flowaid/web": minor
"@flowaid/worker": minor
"@flowaid/nodes-core": minor
"@flowaid/pageindex": minor
"@flowaid/workflow-core": minor
---

PageIndex document intelligence: PageIndex knowledge sources index uploaded PDFs into section
trees with the pinned PageIndex SDK (a private Python service, `./flowaid --pageindex` or the
compose `pageindex` profile), versioned and deduplicated per file. The new nodes
`flowaid.pageindex.index`, `.retrieve` (TypeSafe Jev navigates the tree) and `.cite` (every
citation checked against the page text), document tools for agents, three templates, a source
page with outline, source viewer and test panel, and `pnpm eval:pageindex` (RFC-0022). Also:
the web app opens at http://flowaid.localhost:3000 (API on 3001), `./flowaid` starts everything,
local Ollama works without opening the private network, and upgraded installs receive new
built-in templates.
