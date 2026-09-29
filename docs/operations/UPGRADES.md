# Upgrades

An upgrade is a new version of the three images (or a newer checkout for `pnpm start`). The
database schema moves with it: the api applies the migrations the new release ships before it
serves a request. There is no down migration, so the way back is a restore, and every upgrade
starts with a backup.

## Before you upgrade

1. Read the release notes (the GitHub release, or the root [CHANGELOG.md](../../CHANGELOG.md)).
   While FlowAId is 0.x a breaking change is a `minor` release and says so in its first words.
2. Take a backup as described in [BACKUP_AND_RESTORE.md](BACKUP_AND_RESTORE.md): the database
   dump, the `flowaid-data` volume (the master key) and `.env`. This backup is your rollback.

## Pin what you run

Run a released version, never `latest`, so that every restart runs the images you tested:

```sh
# .env
FLOWAID_IMAGE_TAG=0.4.0            # or 0.4.0@sha256:<digest> to pin the exact image
```

`docker/compose.images.yml` has no default for `FLOWAID_IMAGE_TAG` and refuses to start without
it. The api, worker (also used by `worker-code`) and web images of one release share the tag;
[RELEASING.md](RELEASING.md) shows how to verify an image's provenance before you deploy it.

## Upgrade

### Docker Compose with published images

```sh
# 1. back up (above)
# 2. set the new version in .env
FLOWAID_IMAGE_TAG=0.5.0
# 3. stop the workers, so no old worker runs against the migrated schema
docker compose -f docker/compose.yml -f docker/compose.images.yml stop worker worker-code
# 4. pull and recreate
docker compose -f docker/compose.yml -f docker/compose.images.yml up -d
# with the scale profile:
docker compose -f docker/compose.yml -f docker/compose.scale.yml -f docker/compose.images.yml \
  --profile scale up -d
```

Compose starts the new api first: the workers and the web app wait until the api's health
check passes (`depends_on: service_healthy`), and the api only listens once its migrations are
applied. A run a worker was executing when it stopped is picked up again when its lease
expires (see [RUNBOOK.md](RUNBOOK.md#stuck-runs)).

### Docker Compose built from source

Check out the release tag (`git checkout v0.5.0`), stop the workers
(`docker compose stop worker worker-code`) and run `docker compose up -d --build`.

### Local mode

Stop `pnpm start`, update the checkout (`git pull`, or check out a release tag) and run
`pnpm start` again. It installs dependencies, builds, and the api migrates the local database
on start.

## How migrations run

- The **api** applies migrations at boot, before it listens (`apps/api/src/main.ts`), as the
  schema owner: `DATABASE_ADMIN_URL` (the compose stack sets it to the owner, `POSTGRES_USER`),
  falling back to `DATABASE_URL`. The worker, `worker-code` and the web app never migrate.
- The migrations are the SQL files in
  [`packages/database/migrations/`](../../packages/database/migrations/), applied in order and
  recorded in `drizzle.__drizzle_migrations`. Every pending migration is applied in one
  transaction: a failure leaves the schema as it was and the api exits with the error.
- A PostgreSQL advisory lock serialises migrations, so several api replicas starting at once
  apply them once.
- An upgrade may skip releases: the api applies every migration the database has not seen.
- Nothing checks that a service matches the schema. A worker or api from an older release that
  is still running after the new api migrated may fail on the changed schema.

## Compatibility

- Run the **same version** of the api, worker, `worker-code` and web images. Mixed versions are
  not supported: stop the workers before the new api starts (step 3 above) and upgrade every
  service together.
- Migrations are **forward-only**. Some change or drop existing columns and indexes, so a
  database migrated by a new release is not guaranteed to work with an older one.
- Starting an older release against a newer database is not supported; to go back, restore.
- The Postgres image (`pgvector/pgvector:0.8.6-pg16`, pinned by digest) changes only when a
  release says so. A PostgreSQL major-version change needs a dump and restore; the release
  notes will describe it.

## If an upgrade fails

- **A migration fails.** The transaction rolled back, so the schema is still the old one, and
  the api keeps exiting (the workers wait for its health check). Read the error in
  `docker compose logs api`. Either go back to the previous `FLOWAID_IMAGE_TAG`, which works
  against the untouched schema, or wait for the release that fixes the migration.
- **The upgraded release misbehaves.** Problems are fixed forward: report it, and upgrade to the
  release that fixes it. Do not start the previous images against the migrated database.
- **You need the previous version back now.** Roll back by restoring the backup you took
  before the upgrade, with the previous `FLOWAID_IMAGE_TAG` set
  ([BACKUP_AND_RESTORE.md](BACKUP_AND_RESTORE.md#restore)). Anything created after the backup
  (runs, edits, new credentials) is lost, so take the backup immediately before upgrading.
