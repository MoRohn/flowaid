# @flowaid/cli

The `flowaid` command line (`docs/design/API.md` §8.3).

```sh
flowaid login --api-url http://localhost:3000 --api-key fa_live_…
flowaid workflows list
flowaid workflow run <id> --input @input.json --watch
flowaid run events <runId> --follow
flowaid workflow package <id> --version 3 --out flow.zip
flowaid workflow run --local ./flow.json --input '{"message":"hi"}'
flowaid validate ./flow.json
```

## Generated commands

Every API operation is a command, `flowaid <noun> <verb>`. The commands are generated from the
`x-cli` extension each route declares (`src/generated/operations.ts`, written by
`pnpm sdk:types`). A test checks that every operation has a command.

- Path parameters are positional arguments.
- Query parameters and top-level body fields become `--kebab-case` flags.
- `@file` reads a value from a file (JSON, or YAML for `.yaml`), and `-` reads it from stdin.
- `--body` supplies the whole JSON body; flags override its fields.
- Output is JSON, or YAML with `-o yaml`.
- Binary responses need `--out <file>`.
- Plural nouns work as aliases (`flowaid workflows list`).

## Hand-written commands

| Command                                                                        | What it does                                                                                                                                              |
| ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `login` / `logout`                                                             | checks an API key against `GET /v1/me` and saves it in `$XDG_CONFIG_HOME/flowaid/config.json` (mode 0600); `logout` removes it                            |
| `dev [--down] [--no-open]`                                                     | `docker compose -f docker/compose.yml up -d --wait` from the checkout, then opens the web app                                                             |
| `workflow run <id> [--input] [--sync] [--watch]`                               | starts a run on the server; `--watch` streams its events to stderr and prints the result                                                                  |
| `workflow run --local <file\|dir> [--input] [--secret NAME=value] [--approve]` | runs the definition with the embedded runtime: core nodes, the provider-\* factories and the sandbox. Declared secrets are also read from the environment |
| `workflow export <id> [--version n\|draft] [--format json\|yaml\|ts]`          | one file, from a version or the draft                                                                                                                     |
| `workflow package <id> [--version n\|draft] [--out] [--mode npm\|vendored]`    | the runnable code package (export job → zip)                                                                                                              |
| `run events <id> [--follow]`                                                   | the event log; with `--follow`, the live stream with `Last-Event-ID` resume                                                                               |
| `run stream <id>`                                                              | the live stream as JSON lines, deltas included                                                                                                            |
| `validate <file\|dir>`                                                         | compiles locally with the bundled core nodes, no server needed                                                                                            |

## Connection

The CLI picks its settings in this order: flags (`--api-url`, `--api-key`, `--workspace`),
then the environment (`FLOWAID_API_URL`, `FLOWAID_API_KEY`, `FLOWAID_WORKSPACE`), then the
saved profile. The default URL is `http://localhost:3000`. The CLI's own version flag is `-V`,
because `--version` belongs to `workflow export` and `workflow package`.
