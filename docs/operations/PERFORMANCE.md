# Performance

How FlowAId's capacity is measured, and the latest results.

## Running the load test

`pnpm loadtest` drives a running API (local mode) without any dependency beyond Node:

```sh
RATE_LIMIT_MAX=1000000 ./flowaid            # raise the per-session limit for the measurement
pnpm loadtest -- --api http://flowaid.localhost:3001 --duration 20 --concurrency 1,10,50
```

It signs in through the loopback-only local sign-in, creates a temporary workflow that calls no
model or paid service (input → transform → output), and for each concurrency level runs two
scenarios for `--duration` seconds:

- **reads:** `GET /v1/workflows` and `GET /v1/runs`, alternating;
- **runs:** `POST /v1/workflows/:id/run` as a synchronous draft run, which goes through the API,
  the queue, the worker and the run store and only counts when the run completed.

It prints requests per second, latency percentiles of the successful requests, rate-limited
answers and errors, deletes the workflow, and with `--json <file>` writes the table.

Without the raised `RATE_LIMIT_MAX`, one session is limited to 600 requests a minute and the test
measures the limiter instead.

## Results (2026-10-01)

Development mode (`pnpm start`: TypeScript run from source, one API and one worker process,
PostgreSQL in Docker, Redis), on an Apple-silicon laptop. Production builds are expected to be
faster; these are a floor, not a ceiling.

| scenario | clients | requests | per second | p50 ms | p95 ms | p99 ms | errors |
| -------- | ------: | -------: | ---------: | -----: | -----: | -----: | -----: |
| reads    |       1 |    8 853 |        443 |      2 |      3 |      4 |      0 |
| runs     |       1 |      486 |         24 |     41 |     45 |     50 |      0 |
| reads    |      10 |   30 413 |      1 521 |      6 |      8 |      9 |      0 |
| runs     |      10 |    2 188 |        109 |     91 |    100 |    108 |      0 |
| reads    |      50 |   30 129 |      1 507 |     33 |     37 |     40 |      0 |
| runs     |      50 |    2 370 |        119 |    424 |    453 |    469 |      0 |

Reads level off at about 1 500 a second and complete runs at about 110–120 a second; beyond
roughly ten concurrent callers, more load adds queueing time rather than errors. Nothing failed
and nothing was rate limited across about 74 000 requests.

Not measured yet: production builds, several API or worker replicas, workflows that call models
(their latency is the provider's), and long-running soak tests.
