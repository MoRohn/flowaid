---
"@flowaid/web": patch
---

Knowledge sources can be changed after they are created. The source page has a Settings button
that opens the New source steps on the saved values: rename it, change its addresses, repository
or token, its search (switch to keywords only when the embedding model has no key) and its
chunking, or a PageIndex source's indexing model. Saving asks first when the change indexes every
document again or fetches them again, and keeps settings the form doesn't show.
