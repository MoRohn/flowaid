---
"@flowaid/web": patch
"@flowaid/api": patch
---

Knowledge sources can be changed after they are created. The source page has a Settings button
that opens the New source steps on the saved values: rename it, change its addresses, repository
or token, its search (switch to keywords only when the embedding model has no key) and its
chunking, or a PageIndex source's indexing model. Saving asks first when the change indexes every
document again or fetches them again, and keeps settings the form doesn't show.

A PageIndex source reads consistently when the PageIndex service is turned off: one notice says it
is off and how to turn it on, the documents it holds are listed (the list no longer needs the
service), and uploads, document actions and Try a question are not offered. Before, the banner
said the service was not answering, the table failed to load and Try a question said nothing was
indexed.
