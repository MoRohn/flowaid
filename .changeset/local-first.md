---
"@flowaid/api": minor
"@flowaid/web": minor
"@flowaid/env": minor
---

Local-first by default: on your own computer FlowAId opens without a sign-in (`FLOWAID_AUTH_MODE=auto`
resolves to `local` when the app's URLs are loopback). The api issues the owner's session only to
callers on this computer; behind public URLs, and in the compose stack, email and password sign-in
stays. The web app hides sign-out, members and profile in local mode.
