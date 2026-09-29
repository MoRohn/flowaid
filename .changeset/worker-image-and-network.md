---
"@flowaid/worker": patch
"@flowaid/web": patch
"@flowaid/env": patch
---

Docker Compose fixes:

- The worker image starts again. `zod` was a development-only dependency of the worker, so the
  pruned production image lacked it and the worker and sandbox host crashed at start (0.4.0 and
  0.5.0 images). A repository check now fails when an app's runtime code imports a package that
  is not a runtime dependency.
- Compose defaults to the same address as `./flowaid`, http://flowaid.localhost:3000, and the api
  and worker also read `.env.local`. `APP_BIND_ADDRESS` publishes web and api on the network
  while the databases stay on loopback.
- Sign-in explains when the browser drops the session over plain http on a network address,
  and how to fix it (https, or `FLOWAID_ALLOW_INSECURE_HTTP=true` with the public URLs).
