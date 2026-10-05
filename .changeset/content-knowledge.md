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

Knowledge details: removing the last failed document of an upload source takes it out of Error
(it stayed in Error over an empty table); keyword-only sources no longer mark every chunk "not
embedded"; a missing embedding key reads as what to do about it; Add documents names files it
could not read or that hold no text, and refuses an upload larger than one request takes, instead
of failing silently; and an empty upload source is no longer polled every few seconds.
