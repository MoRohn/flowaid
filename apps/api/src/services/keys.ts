/**
 * `flowaid keys rotate-master` (P3-7, RUNBOOK.md "Key rotation"): moves every key under a new
 * master key. Credentials are sealed under per-credential data keys (DEKs), the DEKs under a
 * key-encryption key (KEK) version, and the KEKs under the master.
 *
 * 1. **KEKs** (one transaction): every `encryption_keys` row wrapped under the current master
 *    (checked by its key check value) is unwrapped, wrapped under the new master and unwrapped
 *    again to prove the round trip; unless `keksOnly`, a new KEK version, wrapped under the new
 *    master, is added and made active; an audit row records the rotation. Rows already under the
 *    new master are left alone, so a rerun after a failure, or after success, is safe; a row
 *    under neither key aborts everything.
 * 2. **Data keys** (unless `keksOnly`): every stored credential still under an older KEK
 *    version is re-sealed under the active one, one row at a time (compare-and-set on its
 *    version), and each re-sealed value is opened before it is written. An interrupted run
 *    continues where it stopped when run again.
 *
 * The api and the worker hold the master in memory and must be stopped while this runs; it
 * refuses to start while they are connected unless `force` is set.
 */
import { and, asc, eq, gt, ne, sql } from "drizzle-orm";
import {
  CredentialService,
  KeyRing,
  MasterKeyMismatchError,
  constantTimeEqual,
  randomKey,
  zeroise,
  type MasterKeyProvider,
} from "@flowaid/credentials";
import {
  PgCredentialRepository,
  PgKekStore,
  credentials,
  encryptionKeys,
  recordAudit,
  type Database,
} from "@flowaid/database";
import { CredentialError } from "@flowaid/workflow-core";

export interface RotateMasterOptions {
  db: Database;
  /** The master key the KEKs are wrapped with now. */
  current: MasterKeyProvider;
  /** The master key to move them to. */
  next: MasterKeyProvider;
  /** Only re-wrap the KEKs; leave the data keys under their KEK versions. */
  keksOnly?: boolean;
  /** Run although api or worker processes are connected to the database. */
  force?: boolean;
  /** Credentials re-sealed per batch (default 100). */
  batchSize?: number;
  log?: (line: string) => void;
}

export interface RotateMasterResult {
  /** KEK versions re-wrapped by this run. */
  rewrapped: number[];
  /** KEK versions that were already under the new master (an earlier run). */
  alreadyRotated: number[];
  /** The KEK version created by this run, if any. */
  newKekVersion: number | null;
  /** Credentials re-sealed under the active KEK version by this run. */
  credentialsResealed: number;
  /** Credentials that could not be re-sealed (left under their old version; see `log`). */
  credentialsFailed: string[];
}

/** Processes that hold a master key in memory (their pool's `application_name`). */
const KEY_HOLDERS = ["flowaid-api", "flowaid-worker"];

export async function rotateMasterKey(options: RotateMasterOptions): Promise<RotateMasterResult> {
  const { db, current, next } = options;
  const log = options.log ?? (() => undefined);
  const [currentKcv, nextKcv] = [await current.kcv(), await next.kcv()];
  if (constantTimeEqual(currentKcv, nextKcv))
    throw new CredentialError("the new master key is the current one; nothing to rotate");

  if (!options.force) {
    const holders = await db.system((tx) =>
      tx.execute<{ name: string; n: number }>(sql`
        select application_name as name, count(*)::int as n from pg_stat_activity
        where datname = current_database() and pid <> pg_backend_pid()
          and application_name in ${KEY_HOLDERS}
        group by application_name`),
    );
    if (holders.length)
      throw new CredentialError(
        `stop the api and the worker first (connected: ${holders.map((h) => `${h.name} ×${h.n}`).join(", ")}); they hold the current master key in memory`,
      );
  }

  // 1. KEKs, in one transaction under the master-key lock
  const phase1 = await db.system(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('flowaid.master_key'))`);
    const rows = await tx
      .select()
      .from(encryptionKeys)
      .orderBy(asc(encryptionKeys.version))
      .for("update");
    const rewrapped: number[] = [];
    const alreadyRotated: number[] = [];
    for (const row of rows) {
      if (constantTimeEqual(row.masterKcv, nextKcv)) {
        alreadyRotated.push(row.version);
        continue;
      }
      if (!constantTimeEqual(row.masterKcv, currentKcv))
        throw new MasterKeyMismatchError(row.masterKcv, currentKcv);
      const kek = await current.unwrap(row.wrappedKek);
      try {
        const wrappedKek = await next.wrap(kek);
        const check = await next.unwrap(wrappedKek);
        const same = check.equals(kek);
        zeroise(check);
        if (!same) throw new CredentialError(`KEK version ${row.version} did not round-trip`);
        await tx
          .update(encryptionKeys)
          .set({ wrappedKek, masterProvider: next.id, masterKcv: nextKcv })
          .where(eq(encryptionKeys.version, row.version));
        rewrapped.push(row.version);
      } finally {
        zeroise(kek);
      }
    }
    // A new KEK only on the run that moved the KEKs: a rerun keeps the one it made.
    let newKekVersion: number | null = null;
    if (!options.keksOnly && rewrapped.length > 0) {
      newKekVersion = rows.reduce((max, r) => Math.max(max, r.version), 0) + 1;
      const kek = randomKey();
      try {
        await tx.update(encryptionKeys).set({ active: false });
        await tx.insert(encryptionKeys).values({
          version: newKekVersion,
          wrappedKek: await next.wrap(kek),
          masterProvider: next.id,
          masterKcv: nextKcv,
          active: true,
        });
      } finally {
        zeroise(kek);
      }
    }
    if (rewrapped.length > 0)
      await recordAudit(tx, {
        workspaceId: null,
        actorType: "system",
        actorId: "flowaid keys rotate-master",
        action: "master_key.rotate",
        resourceType: "encryption_key",
        resourceId: "master",
        details: { rewrapped, newKekVersion, provider: next.id, kcv: nextKcv },
      });
    return { rewrapped, alreadyRotated, newKekVersion };
  });
  log(
    phase1.rewrapped.length
      ? `re-wrapped KEK versions ${phase1.rewrapped.join(", ")} under the new master key`
      : "every KEK version was already under the new master key",
  );
  if (phase1.newKekVersion !== null) log(`added KEK version ${phase1.newKekVersion} (active)`);

  // From here on the new master is the only one that opens anything.
  const keyring = new KeyRing(next, new PgKekStore(db));
  await keyring.verifyMaster();
  const result: RotateMasterResult = {
    ...phase1,
    credentialsResealed: 0,
    credentialsFailed: [],
  };
  if (options.keksOnly) return result;

  // 2. Data keys, resumable
  const service = new CredentialService({ repository: new PgCredentialRepository(db), keyring });
  const active = await keyring.activeVersion();
  const batchSize = options.batchSize ?? 100;
  let after = "";
  for (;;) {
    const batch = await db.system((tx) =>
      tx
        .select({ id: credentials.id, type: credentials.type, keyVersion: credentials.keyVersion })
        .from(credentials)
        .where(
          and(
            eq(credentials.storage, "db"),
            ne(credentials.keyVersion, active),
            gt(credentials.id, after || "00000000-0000-0000-0000-000000000000"),
          ),
        )
        .orderBy(asc(credentials.id))
        .limit(batchSize),
    );
    if (!batch.length) break;
    for (const row of batch) {
      after = row.id;
      try {
        const sealed = await service.rotate(row.id);
        if (!sealed) continue;
        if (!(await service.verifySealed(row.id, row.type, sealed)))
          throw new CredentialError("the re-sealed value does not open");
        const updated = await db.system((tx) =>
          tx
            .update(credentials)
            .set({
              ciphertext: sealed.ciphertext,
              wrappedDataKey: sealed.wrappedDataKey,
              keyVersion: sealed.keyVersion,
              updatedAt: sql`now()`,
            })
            .where(and(eq(credentials.id, row.id), eq(credentials.keyVersion, row.keyVersion ?? 0)))
            .returning({ id: credentials.id }),
        );
        if (updated.length) result.credentialsResealed++;
      } catch (error) {
        result.credentialsFailed.push(row.id);
        log(`credential ${row.id}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
  keyring.forget();
  if (result.credentialsResealed || result.credentialsFailed.length)
    await db.system((tx) =>
      recordAudit(tx, {
        workspaceId: null,
        actorType: "system",
        actorId: "flowaid keys rotate-master",
        action: "master_key.reseal",
        resourceType: "encryption_key",
        resourceId: String(active),
        details: {
          resealed: result.credentialsResealed,
          failed: result.credentialsFailed.length,
        },
      }),
    );
  log(
    `re-sealed ${result.credentialsResealed} credential(s) under KEK version ${active}` +
      (result.credentialsFailed.length
        ? `; ${result.credentialsFailed.length} failed (run the command again to retry them)`
        : ""),
  );
  return result;
}
