# Backup and restore

A FlowAId installation is two things that only work together: the **PostgreSQL database** (the
single source of truth: workflows, runs and their event log, the queue, timers, credentials)
and the **master key** that decrypts the credentials stored in it. Back them up at the same
time and keep them as a pair. A database without its master key restores everything except
the stored credentials, and the api and worker refuse to start until the original key is back
(see [Verify after a restore](#verify-after-a-restore)).

Each stored credential has its own data key, wrapped by a key-encryption key in the
`encryption_keys` table, which in turn is wrapped by the master key. The master key is never
written to the database; `encryption_keys.master_kcv` only records a check value derived from it.

## What to back up

### Docker Compose stack

| What              | Where                                                                              | Why                                                                                                                                                                              |
| ----------------- | ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The database      | the `flowaid` database in the `postgres` service (volume `flowaid_postgres-data`)  | everything FlowAId knows                                                                                                                                                         |
| The master key    | `/data/master.key` in the `flowaid-data` volume, or `FLOWAID_MASTER_KEY` in `.env` | decrypts the stored credentials. `FLOWAID_MASTER_KEY` takes precedence over the file when both exist                                                                             |
| The JWT key pair  | `/data/keys/jwt-private.pem` and `jwt-public.pem` in `flowaid-data`                | signs session tokens. If lost, the api generates a new pair and tokens signed with the old one stop being accepted; nothing else is lost                                         |
| Run artifacts     | `/data/artifacts` in `flowaid-data`, or the S3 bucket when `S3_*` is set           | files nodes produced and code-export packages. With S3, back up the bucket with your storage tooling                                                                             |
| Installed plugins | `/data/plugins` in `flowaid-data`                                                  | plugin packages installed at runtime                                                                                                                                             |
| The `.env` file   | the repository root                                                                | the database passwords (`POSTGRES_PASSWORD`, `POSTGRES_CODE_PASSWORD`, `POSTGRES_APP_PASSWORD`), provider keys and every other setting. It may hold `FLOWAID_MASTER_KEY` as well |

The compose project is named `flowaid`, so Docker names the volumes `flowaid_postgres-data` and
`flowaid_flowaid-data` (`docker volume ls` shows them). `flowaid-data` is mounted at `/data` in
the `api` and `worker` services only. It also holds `worker.heartbeat`, which needs no backup.

Treat the backup of `master.key` and `.env` like the key itself: anyone holding it and a
database dump can decrypt every stored credential. Store it apart from the database dumps,
encrypted.

### Local mode (`pnpm start`)

`pnpm start` keeps its state in the `.flowaid/` directory of the checkout (gitignored) and, unless
you give it a database, in a Docker container:

| What            | Where                                                                                                                                                                                              |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The database    | the `flowaid-dev-db` container (`pgvector/pgvector:0.8.6-pg16`, `127.0.0.1:54329`, database and owner `flowaid`, volume `flowaid-dev-db`), or whatever `--database-url` / `DATABASE_URL` points at |
| The master key  | `FLOWAID_MASTER_KEY` in `.flowaid/dev.env`. `pnpm start` generates it on the first start and it wins over `.flowaid/master.key`, so `dev.env` is the file that matters                             |
| Everything else | `.flowaid/dev.env` also holds the owner's email and password and `FLOWAID_DEV_DB_PASSWORD`; `.flowaid/keys/` holds the JWT pair, `.flowaid/artifacts/` the artifacts, `.flowaid/plugins/` plugins  |

## Back up

### Docker Compose stack

Run these from the repository root. `pg_dump` runs inside the `postgres` container, so its
version always matches the server.

1. Dump the database in the custom format, as the owner role (`POSTGRES_USER`, `flowaid` unless
   you changed it). The owner is the image's superuser, which matters because every table has
   `FORCE ROW LEVEL SECURITY`: a role without `BYPASSRLS` would dump filtered or no rows, and
   pg_dump refuses with "query would be affected by row-level security policy".

   ```sh
   docker compose exec -T postgres \
     pg_dump -U flowaid -d flowaid -Fc > flowaid-$(date +%F).dump
   ```

   The dump is consistent on a running stack (pg_dump reads one snapshot). It includes the
   applied-migrations table (`drizzle.__drizzle_migrations`), but not the login roles, which
   live at the cluster level.

2. Copy the `flowaid-data` volume (master key, JWT keys, artifacts, plugins):

   ```sh
   docker run --rm -v flowaid_flowaid-data:/data:ro -v "$PWD":/backup alpine \
     tar czf /backup/flowaid-data-$(date +%F).tgz -C /data .
   ```

   If `FLOWAID_MASTER_KEY` is set in `.env`, that value is the master key and `master.key` may
   not exist; the `.env` copy in the next step covers it.

3. Copy `.env`.

Take the three in one sitting. A dump restored with a master key from another installation, or
from before the key was replaced, cannot decrypt the credentials.

### Local mode

With the default database container:

```sh
docker exec flowaid-dev-db pg_dump -U flowaid -d flowaid -Fc > flowaid-local-$(date +%F).dump
tar czf flowaid-local-$(date +%F).tgz .flowaid
```

With your own database (`--database-url` or `DATABASE_URL`), run `pg_dump -Fc` against it as a
superuser or a role with `BYPASSRLS`, and archive `.flowaid/` the same way.

## Restore

Restore into an empty installation, in this order: the files and secrets first, then the
database, then the services. The api must not start before the database is restored, because
it applies migrations to whatever database it finds.

### Docker Compose stack

1. Stop the stack. If you are replacing an installation, remove its volumes
   (`docker compose down -v` deletes **all** of them; copy anything you still need first).
2. Put `.env` back at the repository root. The Postgres init script creates the `flowaid_app`
   and `flowaid_code` login roles from its passwords the first time the volume starts.
3. Restore the `flowaid-data` volume:

   ```sh
   docker volume create flowaid_flowaid-data
   docker run --rm -v flowaid_flowaid-data:/data -v "$PWD":/backup alpine \
     tar xzf /backup/flowaid-data-2026-09-28.tgz -C /data
   ```

   The images run as the non-root `flowaid` user; the archive keeps the files' owners and
   modes (`master.key` and `jwt-private.pem` are `0600`).

4. Start only Postgres and wait until it is healthy:

   ```sh
   docker compose up -d --wait postgres
   ```

5. Restore the dump into the empty `flowaid` database as the owner:

   ```sh
   docker compose exec -T postgres \
     pg_restore -U flowaid -d flowaid --exit-on-error < flowaid-2026-09-28.dump
   ```

6. Start everything: `docker compose up -d`. The api checks the master key against the
   database, applies any migrations the dump predates (a dump from an older release is
   upgraded, see [UPGRADES.md](UPGRADES.md)), and only then listens.

### Local mode

1. Stop `pnpm start`, put `.flowaid/` back (`tar xzf flowaid-local-….tgz`), and make sure
   `.flowaid/dev.env` is the one from the backup: its `FLOWAID_DEV_DB_PASSWORD` is the password
   the database container is created with, and its `FLOWAID_MASTER_KEY` decrypts the credentials.
2. Create the database container with that password and restore into it. The roles FlowAId
   grants to do not exist yet in a fresh container (a migration creates them), so create them
   first:

   ```sh
   docker rm -f flowaid-dev-db && docker volume rm flowaid-dev-db   # only when replacing it
   pnpm start        # creates the container and an empty schema; stop it with Ctrl+C
   docker exec -i flowaid-dev-db psql -U flowaid -d postgres \
     -c 'DROP DATABASE flowaid WITH (FORCE)' -c 'CREATE DATABASE flowaid OWNER flowaid'
   docker exec -i flowaid-dev-db pg_restore -U flowaid -d flowaid --exit-on-error \
     < flowaid-local-2026-09-28.dump
   ```

   The first `pnpm start` runs the migrations, which create the `flowaid_app` and `flowaid_code`
   roles; the database is then recreated empty so the dump restores into a clean schema.

3. `pnpm start`.

## Verify after a restore

1. **The api started.** It checks the master key at boot: the `encryption_keys` rows record a
   key check value, `master_kcv`, the base64 of the first 8 bytes of
   `HMAC-SHA256(master key, "flowaid/master-kcv/v1")`. When the configured key does not produce
   it, the api and the worker exit with `E_MASTER_KEY_MISMATCH`:

   ```
   The master key does not match the key-encryption keys in the database (E_MASTER_KEY_MISMATCH); restore the original FLOWAID_MASTER_KEY or key file
   ```

   Put the master key that belongs to this dump back; do not generate a new one. If the log
   instead says `The master key file /data/master.key does not exist`, the `flowaid-data`
   restore did not land (production never generates a key unless
   `FLOWAID_MASTER_KEY_AUTOGENERATE=true`; if it did generate one, it logs
   `WARNING: generated a new master key` and the check above then fails).

   The check runs against every row of `encryption_keys`, which gets its first row when the
   first credential is stored; an installation without stored credentials has nothing to check.

   To check a key before starting anything, compare the value it produces with the database:

   ```sh
   docker compose exec -T postgres psql -U flowaid -d flowaid -Atc \
     'select version, active, master_kcv from encryption_keys'
   node -e 'const k=require("fs").readFileSync(0,"utf8").trim();
     const b=Buffer.from(k,/^[0-9a-f]{64}$/i.test(k)?"hex":"base64");
     console.log(require("crypto").createHmac("sha256",b).update("flowaid/master-kcv/v1").digest().subarray(0,8).toString("base64"))' \
     < master.key
   ```

   This applies to the local key file and `FLOWAID_MASTER_KEY` (base64 or hex); a KMS or Vault
   provider (`FLOWAID_MASTER_KEY_PROVIDER`) computes its own check value.

2. **It is ready.** `GET /v1/ready` returns `{"status":"ready","checks":{"database":"ok"}}`
   (`flowaid system ready` from the CLI), and the worker's health check passes
   (`docker compose ps` shows it healthy).
3. **The data is there.** Sign in, open a few workflows and recent runs, and check that the
   Credentials page lists the stored credentials. Start a draft run of a workflow that uses a
   credential: credentials are decrypted only in the worker, so a successful run proves the key
   end to end.
4. **The schema is current.** The api log shows no migration error, and
   `select count(*) from drizzle.__drizzle_migrations` matches the number of files in
   `packages/database/migrations/` of the running release.
