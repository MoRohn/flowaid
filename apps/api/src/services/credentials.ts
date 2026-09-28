/** The credential service over the database: KEKs in `encryption_keys`, ciphertext in `credentials`. */
import { readFileSync } from "node:fs";
import {
  CredentialService,
  ExternalResolver,
  KeyRing,
  envMasterKey,
  externalResolverOptionsFromEnv,
  fileMasterKey,
  masterKeyProviderFromEnv,
  type ExternalResolverOptions,
  type KeyServiceDeps,
  type MasterKeyProvider,
} from "@flowaid/credentials";
import { PgCredentialRepository, PgKekStore, type Database } from "@flowaid/database";
import type { Env } from "@flowaid/env";
import { sql } from "drizzle-orm";

/** Key services are platform configuration: plain fetch, and the key file from disk. */
export const keyServiceDeps: KeyServiceDeps = {
  http: (url, init) => fetch(url, init),
  readFile: (path) => readFileSync(path, "utf8"),
};

export async function masterKeyFromEnv(
  env: Env,
  db: Database,
  onCreated?: (path: string) => void,
): Promise<MasterKeyProvider> {
  return masterKeyProviderFromEnv(env, keyServiceDeps, async () => {
    if (env.FLOWAID_MASTER_KEY) return envMasterKey(String(env.FLOWAID_MASTER_KEY));
    return fileMasterKey({
      path: String(env.FLOWAID_MASTER_KEY_FILE),
      autogenerate: env.flags.masterKeyAutogenerate,
      // Two replicas booting together must not both create a key file.
      withLock: (fn) =>
        db.system(async (tx) => {
          await tx.execute(sql`select pg_advisory_xact_lock(hashtext('flowaid.master_key'))`);
          return fn();
        }),
      ...(onCreated ? { onCreated } : {}),
    });
  });
}

/** Where external credential references are read from (`FLOWAID_SECRET_*`, Vault, clouds). */
export function externalFromEnv(env: Env): ExternalResolverOptions {
  return externalResolverOptionsFromEnv(env, keyServiceDeps);
}

export async function createCredentialService(
  db: Database,
  master: MasterKeyProvider,
  external?: ExternalResolverOptions,
): Promise<CredentialService> {
  const keyring = new KeyRing(master, new PgKekStore(db));
  // Refuse to start with a different master key than the one that wrapped the stored KEKs.
  await keyring.verifyMaster();
  return new CredentialService({
    repository: new PgCredentialRepository(db),
    keyring,
    ...(external ? { external: new ExternalResolver(external) } : {}),
  });
}
