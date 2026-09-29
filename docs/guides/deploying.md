# Deploying FlowAId to a server

On your own computer, `./flowaid` is all you need (see [Running locally](running-locally.md)).
On a server other people reach, use Docker Compose: the same images the release gate tests,
with password sign-in.

## Sign-in modes

| `FLOWAID_AUTH_MODE` | Who it is for                                                                                                                                 |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `auto` (default)    | `local` when the app's URLs are loopback, `password` otherwise                                                                                |
| `local`             | One person on this computer; no sign-in, sessions only for callers on this machine                                                            |
| `password`          | A server: email and password sign-in for the owner (the compose stack sets it); the first boot prints a generated password unless you set one |

## Start the stack

```sh
cp .env.example .env
for v in POSTGRES_PASSWORD POSTGRES_CODE_PASSWORD; do
  sed -i.bak "s/^$v=$/$v=$(openssl rand -hex 16)/" .env
done
# set FLOWAID_ADMIN_EMAIL / FLOWAID_ADMIN_PASSWORD and your provider keys in .env
docker compose up -d
```

To run a published release instead of building from source, set `FLOWAID_IMAGE_TAG` and add
the images overlay: `docker compose -f docker/compose.yml -f docker/compose.images.yml up -d`
([docs/operations/RELEASING.md](../operations/RELEASING.md)).

## Before you put it on a network

The stack runs PostgreSQL 16 with pgvector, the API, the worker, a separate `worker-code` sandbox
host for code nodes and the web app; queues and the event bus run over PostgreSQL. Before you put
it on a network:

- **Terminate TLS in front** of the web app and the API, set `FLOWAID_BASE_URL`,
  `FLOWAID_WEB_URL` and `CORS_ORIGINS`, and tell the API which proxies to trust
  (`FLOWAID_TRUST_PROXY`).
- **Back up the `flowaid-data` and `postgres-data` volumes.** The master key decrypts every
  stored credential; without it they are lost.
- **Scale out** with `docker compose --profile scale up -d` (Redis and worker replicas), and keep
  artifacts in any S3-compatible store with `S3_*` (or `--profile s3` for a bundled one).

Every variable is documented in [`packages/env/README.md`](../../packages/env/README.md); services,
networks and secret scoping in [`docker/README.md`](../../docker/README.md).
