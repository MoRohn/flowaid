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

Compose reads its settings from `.env`. Keys you keep in `.env.local` (as `./flowaid` allows,
for example `TYPESAFE_API_KEY`) also reach the api and worker, but compose's own settings
(ports, passwords, `APP_BIND_ADDRESS`) must be in `.env`.

The first sign-in uses `FLOWAID_ADMIN_EMAIL` and `FLOWAID_ADMIN_PASSWORD`; without a password,
the first boot prints a generated one in `docker compose logs api`.

## Open it from other devices

On the machine running the stack, open **http://flowaid.localhost:3000** (or the `WEB_PORT` you
set): any `*.localhost` name reaches that machine, and browsers keep the session there over plain
http, so nothing else needs setting.

By default every port is published on `127.0.0.1`, so the stack answers only on that machine. To
open it from other devices, give the machine a FlowAId name on your network (for example
`flowaid.lan`, in your router's local DNS or each device's hosts file) and add to `.env`:

```sh
APP_BIND_ADDRESS=0.0.0.0                     # web and api on the network; databases stay on loopback
FLOWAID_WEB_URL=http://flowaid.lan:3000      # the address people open
FLOWAID_BASE_URL=http://flowaid.lan:3001     # the api, as browsers and webhook callers reach it
CORS_ORIGINS=http://flowaid.lan:3000
FLOWAID_ALLOW_INSECURE_HTTP=true             # plain http on a private network; not needed with https
```

Then `docker compose up -d` again. Without `FLOWAID_ALLOW_INSECURE_HTTP=true` (or https), the
browser discards the session cookie on a plain `http://` address that is not `localhost`: sign-in
seems to succeed and returns to the sign-in page, which then says why. Beyond a private network,
put a TLS reverse proxy in front of web and api and use `https://` addresses instead.

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
