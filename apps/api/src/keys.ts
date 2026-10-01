/**
 * `flowaid keys rotate-master`: the operator command behind RUNBOOK.md "Key rotation". It runs
 * with the api's environment (the current master key and `DATABASE_URL`), with the api and the
 * worker stopped:
 *
 *   pnpm keys rotate-master --new-key-file ~/.flowaid/master.key.new --generate      (source)
 *   docker compose run --rm api node dist/keys.js rotate-master --new-key-file /data/master.key.new --generate
 *
 * Options: `--new-key-file <path>` (with `--generate`, created 0600 when missing) or
 * `--new-key-env <NAME>` (a variable holding the new key, base64 or hex); `--keks-only` re-wraps
 * the key-encryption keys without re-sealing the credentials' data keys; `--force` runs while
 * api or worker processes are connected. Exit codes: 0 done, 1 failed, 2 usage.
 */
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import {
  envMasterKey,
  fileMasterKey,
  masterKeyProviderFromEnv,
  type MasterKeyProvider,
} from "@flowaid/credentials";
import { createDatabaseFromEnv } from "@flowaid/database";
import { CredentialError } from "@flowaid/workflow-core";
import { loadEnv, pickEnv, type Env } from "@flowaid/env";
import { keyServiceDeps } from "./services/credentials.js";
import { rotateMasterKey } from "./services/keys.js";

const USAGE = `usage: flowaid keys rotate-master (--new-key-file <path> [--generate] | --new-key-env <NAME>) [--keks-only] [--force]`;

/** The master key the environment configures now; never generates one. */
export function currentMasterKey(env: Env): Promise<MasterKeyProvider> {
  return masterKeyProviderFromEnv(env, keyServiceDeps, async () =>
    env.FLOWAID_MASTER_KEY
      ? envMasterKey(String(env.FLOWAID_MASTER_KEY))
      : fileMasterKey({ path: String(env.FLOWAID_MASTER_KEY_FILE), autogenerate: false }),
  );
}

/** `--new-key-env NAME`: the key in that variable (base64 or hex), never echoed. */
function newKeyFromVariable(name: string): MasterKeyProvider {
  const value = pickEnv([name])[name];
  if (!value) throw new CredentialError(`${name} is not set (--new-key-env names the variable)`);
  try {
    return envMasterKey(value);
  } catch {
    throw new CredentialError(
      `${name} must be 32 random bytes as base64 (44 characters) or hex (64 characters)`,
    );
  }
}

export async function keysCommand(
  argv: readonly string[],
  env: Env,
  out: (line: string) => void,
): Promise<number> {
  const [command, ...rest] = argv;
  if (command !== "rotate-master") {
    out(USAGE);
    return 2;
  }
  let values;
  try {
    ({ values } = parseArgs({
      args: [...rest],
      options: {
        "new-key-file": { type: "string" },
        "new-key-env": { type: "string" },
        generate: { type: "boolean", default: false },
        "keks-only": { type: "boolean", default: false },
        force: { type: "boolean", default: false },
      },
      strict: true,
    }));
  } catch (error) {
    out(`${error instanceof Error ? error.message : String(error)}\n${USAGE}`);
    return 2;
  }
  const file = values["new-key-file"];
  const variable = values["new-key-env"];
  if (Boolean(file) === Boolean(variable)) {
    out(`name the new key with exactly one of --new-key-file and --new-key-env\n${USAGE}`);
    return 2;
  }
  const next = file
    ? await fileMasterKey({
        path: file,
        autogenerate: values.generate,
        onCreated: (path) => out(`generated a new master key at ${path} (mode 0600); back it up`),
      })
    : newKeyFromVariable(variable ?? "");
  const db = createDatabaseFromEnv(env, { applicationName: "flowaid-keys", max: 2 });
  try {
    const result = await rotateMasterKey({
      db,
      current: await currentMasterKey(env),
      next,
      keksOnly: values["keks-only"],
      force: values.force,
      log: out,
    });
    if (result.credentialsFailed.length) return 1;
    out(
      file
        ? `done. Point FLOWAID_MASTER_KEY_FILE at ${file} (or move it over the old key file) for the api and the worker, then start them.`
        : `done. Set FLOWAID_MASTER_KEY to the value of ${variable} for the api and the worker, then start them.`,
    );
    return 0;
  } finally {
    await db.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [, , noun, ...args] = process.argv;
  // `node dist/keys.js rotate-master …` and `pnpm keys rotate-master …` (noun optional)
  const argv = noun === "keys" ? args : [noun ?? "", ...args];
  keysCommand(argv, loadEnv(), (line) => process.stdout.write(`${line}\n`)).then(
    (code) => process.exit(code),
    (error: unknown) => {
      process.stderr.write(
        `flowaid keys: ${error instanceof Error ? error.message : String(error)}\n`,
      );
      process.exit(1);
    },
  );
}
