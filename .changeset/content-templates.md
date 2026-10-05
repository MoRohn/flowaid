---
"@flowaid/web": patch
---

Use template picks the knowledge source a template reads. Document Q&A, the PageIndex agent and
compare templates, and GitHub issue triage with a knowledge base now offer the workspace's sources
of the kind they read (PageIndex PDFs, or chunked documents) and send the choice with the create,
so the copy no longer opens with an unresolved placeholder. A card counts only sources of the right
kind as ready and says when PageIndex is turned off. Template search covers the business flows too:
searching "expense" finds Expense approval instead of "No templates match". Pressing Enter in the
name field no longer creates the workflow before Review.
