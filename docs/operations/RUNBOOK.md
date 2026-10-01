# Runbook

How to tell whether a FlowAId installation is healthy and what to do when it is not. Commands
assume the Docker Compose stack run from the repository root; `docker compose exec -T postgres
psql -U flowaid -d flowaid` opens a SQL prompt as the owner (in local mode:
`docker exec -it flowaid-dev-db psql -U flowaid -d flowaid`). The `flowaid` CLI
([packages/cli](../../packages/cli/README.md)) talks to the api with an API key.

## Health

| Check               | What it tells you                                                                                                                                                                                |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /v1/health`    | the api process is up: `{"status":"ok","version":"…"}`. Public, not rate-limited, checks nothing else. The api container's health check. CLI: `flowaid system health`                            |
| `GET /v1/ready`     | the api can reach the database (`select 1`): 200 `{"status":"ready","checks":{"database":"ok"}}`, or 503 `{"status":"unavailable","checks":{"database":"<error>"}}`. CLI: `flowaid system ready` |
| worker health check | `node dist/health.js` in the worker image exits 0 while the worker's heartbeat file is at most 45 s old. The worker rewrites it every 10 s                                                       |
| `docker compose ps` | the health of every service; `postgres` → `api` → `worker`, `worker-code`, `web` start in that order, each once the previous one is healthy                                                      |

The worker has no HTTP port. It writes `{ "at", "pid" }` to `worker.heartbeat` next to the master
key file (`/data/worker.heartbeat` in compose, `.flowaid/worker.heartbeat` in local mode); a
worker that does not serve the `general` pool, such as `worker-code`, writes it to its temporary
directory instead. Every worker replica shares the `flowaid-data` volume and so the same file:
with several replicas, a fresh heartbeat shows that at least one of them is alive, not that
each is.

## Logs

The api and the worker write one JSON object per line. The api logs through pino (Fastify's
logger, numeric levels: 30 info, 40 warn, 50 error, request lines at `info`); `LOG_LEVEL`
(default `info`; `pnpm start` defaults to `warn`) sets its minimum level. The worker writes
`{ "level": "info" | "warn" | "error", "msg", …, "time" }`, errors to stderr. The api redacts the
`authorization` and `cookie` request headers, and the E2E suite checks with canary values that
secrets never reach the logs.

```sh
docker compose logs -f api worker worker-code
docker compose logs --since 1h api | grep '"level":50'        # api errors
docker compose logs --since 1h worker | grep '"level":"error"'  # worker errors
```

`pnpm start` prints every process's lines with a prefix (`api`, `worker`, `web`) in the terminal
and keeps no log files. The one-time first-boot owner password is printed to stdout outside the
structured logs.

## Metrics and traces

- **Prometheus.** Set `PROMETHEUS_PORT` (for example `9464`; it must differ from `PORT`) and the
  api and the worker each serve `GET /metrics` on that port, on every interface of their
  container. The compose file does not publish it: scrape from a container on the stack's
  network, or publish the port on `BIND_ADDRESS` yourself. `worker-code` does not read `.env`
  and exports no metrics.
- **OpenTelemetry.** Set `OTEL_EXPORTER_OTLP_ENDPOINT` to an OTLP/HTTP collector
  (`http://collector:4318`) and traces and the same metrics are pushed to `/v1/traces` and
  `/v1/metrics` under it.

The metrics (`packages/observability/src/metrics.ts`; counters are scraped with `_total`,
histograms with `_bucket`, `_sum` and `_count`):

| Metric                                              | Type      | Labels                                | Watch for                                                             |
| --------------------------------------------------- | --------- | ------------------------------------- | --------------------------------------------------------------------- |
| `flowaid_runs_total`                                | counter   | `workflow`, `env`, `status`, `origin` | the rate of `status="failed"` and `"timed_out"`                       |
| `flowaid_run_duration_ms`                           | histogram |                                       | runs getting slower                                                   |
| `flowaid_queue_latency_ms`                          | histogram |                                       | time from enqueue to start growing: too few workers, or workers stuck |
| `flowaid_node_runs_total`                           | counter   | `type`, `status`                      | one node type failing                                                 |
| `flowaid_node_duration_ms`                          | histogram | `type`                                |                                                                       |
| `flowaid_retries_total`                             | counter   | `type`, `code`                        | a burst of one error code                                             |
| `flowaid_lease_takeovers_total`                     | counter   |                                       | any increase: a worker died or stalled and another took over its runs |
| `flowaid_provider_errors_total`                     | counter   | `provider`, `code`                    | a model provider failing (keys, quota, outage)                        |
| `flowaid_provider_failover_total`                   | counter   | `from`, `to`                          | traffic moving to the fallback provider                               |
| `flowaid_ai_cost_usd_total`                         | counter   | `provider`, `model`                   | spend                                                                 |
| `flowaid_tokens_total`                              | counter   | `provider`, `model`, `direction`      |                                                                       |
| `flowaid_decision_confidence`                       | histogram | `kind`, `provider`                    | confidence drifting down                                              |
| `flowaid_tool_calls_total`                          | counter   | `tool`, `status`                      | a tool failing                                                        |
| `flowaid_tool_duration_ms`                          | histogram |                                       |                                                                       |
| `flowaid_human_tasks_total`                         | counter   | `mode`, `action`                      |                                                                       |
| `flowaid_queue_depth`, `flowaid_worker_active_runs` | gauge     | `queue` / `pool`                      | declared, but not recorded yet: use the backlog query below instead   |

## Stuck runs

A run is executed by one worker at a time, which holds a **lease** on it (`runs.lease_owner`,
`runs.lease_until`, 30 s, renewed every 10 s). When a worker dies or stalls, its lease expires
and another worker takes the run over within about 15 s and continues it from its event log
(`flowaid_lease_takeovers_total` counts these). **Timers** (`run_timers`: delays, timeouts,
retry back-off, schedules) are polled every second and fire even after a restart. A run that
waits for a person is `waiting_for_human` and stays so until the human task is answered.

Non-terminal runs and their leases:

```sql
select id, status, lease_owner, lease_until, cancel_requested_at
from runs
where status in ('queued', 'starting', 'running', 'waiting', 'waiting_for_human', 'retrying')
order by lease_until nulls first;
```

- `lease_until` in the past while workers are healthy: no worker is picking the run up. Check
  that the worker is up and serves the run's pool (`WORKER_POOLS`), then look at the worker log.
- Timers that should have fired:

  ```sql
  select run_id, purpose, fire_at, locked_by
  from run_timers
  where fired_at is null and cancelled_at is null and fire_at < now() - interval '1 minute';
  ```

What you can do with a run (API or CLI; every action is recorded in the audit log):

| Action     | API                                            | CLI                                         | Effect                                                                                                                   |
| ---------- | ---------------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Cancel     | `POST /v1/runs/:id/cancel`                     | `flowaid run cancel <id>`                   | the lease holder stops the run at its next heartbeat; an idle run is cancelled by a control job. 409 if already terminal |
| Retry node | `POST /v1/runs/:id/node-runs/:nodeRunId/retry` | `flowaid run retry-node <id> <nodeRunId>`   | a failed run reopens in place and continues from the failed node                                                         |
| Restart    | `POST /v1/runs/:id/restart`                    | `flowaid run restart <id> --node-id <node>` | a new run that reuses the results before the node and executes the node and everything after it                          |
| Replay     | `POST /v1/runs/:id/replay`                     | `flowaid run replay <id>`                   | a new run with the same input, on the same or another version                                                            |
| Fork       | `POST /v1/runs/:id/fork`                       | `flowaid run fork <id>`                     | a new run on another version or the draft, with patched input or variables                                               |

There is no command that edits a run's state directly; never update `runs` by hand. Cancel a
run that cannot make progress and restart or replay it.

## Queue backlog and dead letters

Without Redis the queue is the `queue_jobs` table (queues `run:<pool>`, `run:control`,
`schedule`, `ingest`, `evaluation`, `trace_review`, `jobs`, `maintenance`). A claimed job is
invisible to other workers for 5 minutes and extended while it runs; a failed job is retried
with exponential back-off (1 s doubling, at most 5 min) up to `max_attempts` (5 by default).

Backlog per queue:

```sql
select queue, count(*) as waiting, min(run_at) as oldest
from queue_jobs
where done_at is null
group by queue order by waiting desc;
```

There is no separate dead-letter queue: a job that failed its last attempt is marked done and
keeps its error. Jobs that ran out of attempts:

```sql
select id, queue, attempts, max_attempts, last_error, done_at
from queue_jobs
where done_at is not null and attempts >= max_attempts and last_error is not null
order by done_at desc limit 50;
```

`last_error` is not cleared when a later attempt succeeds, so a job that succeeded on a retry
also has one; the `attempts >= max_attempts` condition is what marks a dead one (a job that
succeeded on its last attempt matches too; check the run it belongs to). After fixing the
cause, a dead job can be queued again:

```sql
update queue_jobs set done_at = null, attempts = 0, run_at = now()
where id = '<job id>';
```

With Redis (`REDIS_URL` set, the scale profile) the queue is BullMQ: each job runs once and a
failed job is kept for 7 days in BullMQ's failed set. The run itself records the failure in
either case, so the run's events are usually the better place to start.

## Scaling workers

Workers scale horizontally; every replica claims work from the same queue. The scale overlay
adds Redis (the BullMQ queue and the Redis event bus) and runs `WORKER_REPLICAS` workers, as
described in [docker/README.md](../../docker/README.md#scaling-composescaleyml-profile-scale):

```sh
# .env
REDIS_PASSWORD=<openssl rand -hex 16>
REDIS_URL=redis://:${REDIS_PASSWORD}@redis:6379
WORKER_REPLICAS=3

docker compose --profile scale up -d
```

With published images, name the files explicitly:
`docker compose -f docker/compose.yml -f docker/compose.scale.yml -f docker/compose.images.yml --profile scale up -d`.

Per replica, `WORKER_CONCURRENCY` (default 10) caps concurrent executions; `worker-code` has its
own `WORKER_CODE_CONCURRENCY` (default 4). Scale when `flowaid_queue_latency_ms` or the backlog
grows while the workers are healthy.

## Key services

The master key stays local unless `FLOWAID_MASTER_KEY_PROVIDER` names a key service
(`aws-kms`, `vault-transit`, `azure-keyvault`, `gcp-kms`); `FLOWAID_MASTER_KEY_ID` names the key.
External credential references (`env:`, `vault:`, `aws-sm:`, `azure-kv:`, `gcp-sm:`) are read
when a run uses them and cached for five minutes. The api and the worker build both from the same
variables, so set them on both. Every variable is described in
[packages/env/README.md](../../packages/env/README.md).

**AWS.** FlowAId signs KMS and Secrets Manager requests itself (Signature Version 4); no AWS SDK
or CLI is needed in the image.

- Credentials: `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` (plus `AWS_SESSION_TOKEN` for
  temporary credentials); without them, the ECS task role, then the EC2 instance profile
  (IMDSv2). Other sources (`~/.aws` profiles, SSO, web identity, EKS Pod Identity) are not read;
  export their keys into the environment instead.
- The region is the one in the key's or secret's ARN, so `FLOWAID_MASTER_KEY_ID` must be a key
  or alias ARN (`arn:aws:kms:<region>:<account>:key/<id>`) and an `aws-sm:` reference a full
  secret ARN (`aws-sm:arn:aws:secretsmanager:<region>:<account>:secret:<name>[#<json key>]`).
- IAM: `kms:Encrypt` and `kms:Decrypt` on the master key; `secretsmanager:GetSecretValue` on the
  secrets references name (plus `kms:Decrypt` on their key when it is a customer managed key).
- Testing against LocalStack: `AWS_ENDPOINT_URL=http://localhost:4566` with any access key pair.
  Errors name the operation, the HTTP status and the AWS error type
  (`AWS kms Decrypt failed (400 IncorrectKeyException)`), never the response body.

Switching providers is a master rotation, which is not available yet (below): KEKs wrapped by one
provider do not unwrap with another, and the api refuses to start with `E_MASTER_KEY_MISMATCH`.

## Key rotation

- **A credential's secret values** can be replaced: `POST /v1/credentials/:id/rotate` (CLI
  `flowaid credential rotate <id>`) stores new values and re-encrypts them under the active key.
  Credentials stored in an external secret manager are rotated there.
- **The master key** cannot be rotated yet. `@flowaid/credentials` implements re-wrapping every
  key-encryption key under a new master key, but no CLI command or API route runs it (the
  `flowaid keys rotate-master` command in ARCHITECTURE.md §10.6 is planned, not available).
  Until it is, keep the master key where it is and back it up
  ([BACKUP_AND_RESTORE.md](BACKUP_AND_RESTORE.md)); replacing `master.key` or
  `FLOWAID_MASTER_KEY` makes the api and worker refuse to start with `E_MASTER_KEY_MISMATCH`.
- **The JWT signing keys** (`/data/keys`) can be replaced by deleting the pair and restarting
  the api, which generates a new one; session tokens signed with the old pair stop being
  accepted.
- **Database passwords** are changed with `ALTER ROLE … PASSWORD` and then in `.env`; the Postgres
  init script only applies `.env` passwords to a new, empty volume.
