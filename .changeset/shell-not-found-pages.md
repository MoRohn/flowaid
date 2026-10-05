---
"@flowaid/web": patch
"@flowaid/ui": patch
---

Wrong links and an unreachable API get real pages. A path no page answers shows "This page does
not exist" inside the usual frame, with links back into the workspace, instead of a bare 404. A
link whose id is malformed (`/runs/not-a-uuid`) says Not found and links back to its list instead
of "request params is invalid" with a Try again that could not help; missing knowledge sources and
evaluation sets link back too. A workspace that does not exist says so and offers the same page in
your workspaces instead of silently opening another one. When FlowAId's API cannot be reached, the
page says so, explains how to start FlowAId again, and opens by itself once the API answers.
Not-found and error pages have a heading. `EmptyState` takes `titleAs` to make its title a
heading.
