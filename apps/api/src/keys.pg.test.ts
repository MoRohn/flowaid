import { randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import {
  CredentialService,
  KeyRing,
  MasterKeyMismatchError,
  envMasterKey,
  type MasterKeyProvider,
} from "@flowaid/credentials";
import {
  PgCredentialRepository,
  PgKekStore,
  auditEvents,
  credentials,
  encryptionKeys,
  type Database,
} from "@flowaid/database";
import {
  createTestDatabase,
  describeDb,
  seedTenant,
  type TestDatabase,
} from "@flowaid/database/testing";
import { uuidv7 } from "@flowaid/shared";
import type { Env } from "@flowaid/env";
import { keysCommand } from "./keys.js";
import { createCredentialService } from "./services/credentials.js";
import { rotateMasterKey } from "./services/keys.js";

const key = () => randomBytes(32).toString("base64");

describeDb("flowaid keys rotate-master (Postgres)", () => {
  let t: TestDatabase;
  let workspaceId: string;
  beforeAll(async () => {
    t = await createTestDatabase();
    workspaceId = (await seedTenant(t.app)).workspaceId;
  });
  afterAll(async () => {
    await t?.drop();
  });

  /** Empties the key tables, then stores `values` under `master` (two KEK versions in use). */
  async function seed(master: MasterKeyProvider, values: string[]): Promise<string[]> {
    await t.app.system(async (tx) => {
      await tx.delete(credentials);
      await tx.delete(encryptionKeys);
    });
    const service = await createCredentialService(t.app, master);
    const keyring = new KeyRing(master, new PgKekStore(t.app));
    const ids: string[] = [];
    for (const [i, token] of values.entries()) {
      // the second half lands under a second KEK version
      if (i === Math.ceil(values.length / 2)) await keyring.createVersion();
      const id = uuidv7();
      const sealed = await service.seal(id, "http.bearer", { token });
      await t.app.system((tx) =>
        tx.insert(credentials).values({
          id,
          workspaceId,
          name: `cred-${i}-${id.slice(-6)}`,
          type: "http.bearer",
          ciphertext: sealed.ciphertext,
          wrappedDataKey: sealed.wrappedDataKey,
          keyVersion: sealed.keyVersion,
        }),
      );
      ids.push(id);
    }
    return ids;
  }

  const decryptAll = async (db: Database, master: MasterKeyProvider, ids: string[]) => {
    const service = await createCredentialService(db, master);
    return Promise.all(ids.map(async (id) => (await service.decrypt(id)).token));
  };
  const kekRows = () => t.app.system((tx) => tx.select().from(encryptionKeys));

  it("moves every KEK and data key under the new master, verified, and audits it", async () => {
    const [a, b] = [envMasterKey(key()), envMasterKey(key())];
    const ids = await seed(a, ["one", "two", "three", "four"]);
    const before = await kekRows();
    expect(before.map((r) => r.version).sort()).toEqual([1, 2]);

    const result = await rotateMasterKey({ db: t.app, current: a, next: b });
    expect(result).toMatchObject({
      rewrapped: [1, 2],
      alreadyRotated: [],
      newKekVersion: 3,
      credentialsResealed: 4,
      credentialsFailed: [],
    });
    const after = await kekRows();
    expect(new Set(after.map((r) => r.masterKcv))).toEqual(new Set([await b.kcv()]));
    expect(after.find((r) => r.active)?.version).toBe(3);
    const versions = await t.app.system((tx) =>
      tx.select({ v: credentials.keyVersion }).from(credentials),
    );
    expect(versions.every((r) => r.v === 3)).toBe(true);
    // the new key opens everything; the old one no longer starts
    expect(await decryptAll(t.app, b, ids)).toEqual(["one", "two", "three", "four"]);
    await expect(createCredentialService(t.app, a)).rejects.toBeInstanceOf(MasterKeyMismatchError);
    const audit = await t.app.system((tx) =>
      tx.select().from(auditEvents).where(eq(auditEvents.resourceType, "encryption_key")),
    );
    expect(audit.map((r) => r.action).sort()).toEqual(["master_key.reseal", "master_key.rotate"]);
    expect(JSON.stringify(audit)).not.toContain("one");
  });

  it("is safe to run again, and resumes data keys an earlier run left behind", async () => {
    const [a, b] = [envMasterKey(key()), envMasterKey(key())];
    const ids = await seed(a, ["alpha", "beta", "gamma"]);
    // an earlier run moved the KEKs and then stopped before any data key
    const first = await rotateMasterKey({ db: t.app, current: a, next: b, keksOnly: true });
    expect(first.rewrapped).toEqual([1, 2]);
    expect(first.newKekVersion).toBeNull();
    // a rerun with keksOnly=false: KEKs are already moved, so no new KEK; data keys move to
    // the active version (2) where they were not already
    const again = await rotateMasterKey({ db: t.app, current: a, next: b });
    expect(again).toMatchObject({ rewrapped: [], alreadyRotated: [1, 2], newKekVersion: null });
    expect(again.credentialsResealed).toBe(2);
    const third = await rotateMasterKey({ db: t.app, current: a, next: b });
    expect(third.credentialsResealed).toBe(0);
    expect(await decryptAll(t.app, b, ids)).toEqual(["alpha", "beta", "gamma"]);
  });

  it("re-seals the rest when one credential does not open, and reports it", async () => {
    const [a, b] = [envMasterKey(key()), envMasterKey(key())];
    const ids = await seed(a, ["good-1", "broken", "good-2"]);
    const broken = ids[1] ?? "";
    await t.app.system((tx) =>
      tx
        .update(credentials)
        .set({ ciphertext: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" })
        .where(eq(credentials.id, broken)),
    );
    const lines: string[] = [];
    const result = await rotateMasterKey({
      db: t.app,
      current: a,
      next: b,
      log: (l) => lines.push(l),
    });
    expect(result.credentialsFailed).toEqual([broken]);
    expect(result.credentialsResealed).toBe(2);
    expect(lines.join("\n")).toMatch(/1 failed \(run the command again/);
    const [good1, , good2] = ids;
    expect(await decryptAll(t.app, b, [good1 ?? "", good2 ?? ""])).toEqual(["good-1", "good-2"]);
  });

  it("changes nothing when a KEK is under neither key", async () => {
    const [a, b, stranger] = [envMasterKey(key()), envMasterKey(key()), envMasterKey(key())];
    const ids = await seed(a, ["x", "y"]);
    const before = await kekRows();
    await expect(rotateMasterKey({ db: t.app, current: stranger, next: b })).rejects.toBeInstanceOf(
      MasterKeyMismatchError,
    );
    expect(await kekRows()).toEqual(before);
    expect(await decryptAll(t.app, a, ids)).toEqual(["x", "y"]);
    await expect(rotateMasterKey({ db: t.app, current: a, next: a })).rejects.toThrow(
      /nothing to rotate/,
    );
  });

  it("refuses while the api or the worker is connected", async () => {
    const a = envMasterKey(key());
    await seed(a, ["z"]);
    const { createDatabase } = await import("@flowaid/database");
    const api = createDatabase({ url: t.appUrl, max: 1, applicationName: "flowaid-api" });
    try {
      await api.sql`select 1`;
      await expect(
        rotateMasterKey({ db: t.app, current: a, next: envMasterKey(key()) }),
      ).rejects.toThrow(/stop the api and the worker first/);
    } finally {
      await api.close();
    }
  });

  it("runs as a command with a generated key file", async () => {
    const current = key();
    const ids = await seed(envMasterKey(current), ["from the command"]);
    const dir = mkdtempSync(join(tmpdir(), "flowaid-keys-"));
    const path = join(dir, "master.key.new");
    const env = {
      DATABASE_URL: t.appUrl,
      DB_RLS: true,
      FLOWAID_MASTER_KEY_PROVIDER: "local",
      FLOWAID_MASTER_KEY: current,
    } as unknown as Env;
    const lines: string[] = [];
    expect(await keysCommand(["rotate-master"], env, (l) => lines.push(l))).toBe(2);
    expect(
      await keysCommand(["rotate-master", "--new-key-file", path, "--generate"], env, (l) =>
        lines.push(l),
      ),
    ).toBe(0);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(lines.join("\n")).toMatch(/Point FLOWAID_MASTER_KEY_FILE at/);
    const next = envMasterKey(readFileSync(path, "utf8").trim());
    expect(await decryptAll(t.app, next, ids)).toEqual(["from the command"]);
    // an existing key file is used as it is
    const other = join(dir, "other.key");
    writeFileSync(other, key(), { mode: 0o600 });
    const rerun = await keysCommand(
      ["rotate-master", "--new-key-file", other],
      { ...env, FLOWAID_MASTER_KEY: readFileSync(path, "utf8").trim() } as Env,
      (l) => lines.push(l),
    );
    expect(rerun).toBe(0);
  });

  it("takes the new key from a variable", async () => {
    const [current, next] = [key(), key()];
    const ids = await seed(envMasterKey(current), ["from a variable"]);
    vi.stubEnv("FLOWAID_NEW_MASTER_KEY", next);
    try {
      const env = {
        DATABASE_URL: t.appUrl,
        DB_RLS: true,
        FLOWAID_MASTER_KEY_PROVIDER: "local",
        FLOWAID_MASTER_KEY: current,
      } as unknown as Env;
      const lines: string[] = [];
      const code = await keysCommand(
        ["rotate-master", "--new-key-env", "FLOWAID_NEW_MASTER_KEY", "--keks-only"],
        env,
        (l) => lines.push(l),
      );
      expect(code).toBe(0);
      expect(lines.join("\n")).toMatch(
        /Set FLOWAID_MASTER_KEY to the value of FLOWAID_NEW_MASTER_KEY/,
      );
      expect(lines.join("\n")).not.toContain(next);
      expect(await decryptAll(t.app, envMasterKey(next), ids)).toEqual(["from a variable"]);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("leaves credential rows of other workspaces readable through the repository", async () => {
    // the repository in tenant scope still decrypts after rotation (RLS unaffected)
    const [a, b] = [envMasterKey(key()), envMasterKey(key())];
    const [id] = await seed(a, ["tenant"]);
    await rotateMasterKey({ db: t.app, current: a, next: b });
    const service = new CredentialService({
      repository: new PgCredentialRepository(t.app, { workspaceId }),
      keyring: new KeyRing(b, new PgKekStore(t.app)),
    });
    expect(await service.decrypt(id ?? "")).toEqual({ token: "tenant" });
  });
});
