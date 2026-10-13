---
"@flowaid/api": patch
"@flowaid/mcp": patch
"@flowaid/web": patch
---

Production dependencies that the audit flags as high are updated. Next.js is 16.3.8, the MCP SDK is 1.31.0, and the copies of sharp and source-map-js that Next pulls in are 0.35.5 and 1.2.2.

Closing a stdio MCP server retries deleting its temporary directory. On Windows that folder stays locked for a moment after the process tree is killed.
