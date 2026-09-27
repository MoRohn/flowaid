/** The credential service over the database: KEKs in `encryption_keys`, ciphertext in `credentials`. */
import {
  CredentialService,
  KeyRing,
  envMasterKey,
  fileMasterKey,
  type MasterKeyProvider,
} from "@flowaid/credentials";
import { PgCredentialRepository, PgKekStore, type Database } from "@flowaid/database";
import type { Env } from "@flowaid/env";
import { sql } from "drizzle-orm";

export async function masterKeyFromEnv(
  env: Env,
  db: Database,
  onCreated?: (path: string) => void,
): Promise<MasterKeyProvider> {
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
}

export async function createCredentialService(
  db: Database,
  master: MasterKeyProvider,
): Promise<CredentialService> {
  const keyring = new KeyRing(master, new PgKekStore(db));
  // Refuse to start with a different master key than the one that wrapped the stored KEKs.
  await keyring.verifyMaster();
  return new CredentialService({ repository: new PgCredentialRepository(db), keyring });
}
