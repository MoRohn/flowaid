/**
 * Key-encryption keys (ARCHITECTURE.md §10.6, DATABASE.md `encryption_keys`). Each KEK version
 * is stored wrapped by the master key provider together with the master's KCV. The KeyRing
 * verifies the master at boot, unwraps KEKs on demand, creates new versions, and rotates the
 * master by re-wrapping every KEK in one transaction. Storage is injected (`KekStore`).
 */
import { InternalError } from "@flowaid/workflow-core";
import { constantTimeEqual, randomKey, zeroise } from "./cipher.js";
import type { MasterKeyProvider } from "./masterKey/types.js";

export interface KekRow {
  version: number;
  wrappedKek: string;
  masterProvider: string;
  masterKcv: string;
  active: boolean;
}

export interface KekStore {
  list(): Promise<KekRow[]>;
  insert(row: KekRow): Promise<void>;
  /** Marks exactly one version active. */
  activate(version: number): Promise<void>;
  /** Replaces the wrapped KEKs of several versions atomically (master rotation). */
  rewrap(
    rows: readonly {
      version: number;
      wrappedKek: string;
      masterProvider: string;
      masterKcv: string;
    }[],
  ): Promise<void>;
}

/** The master key does not match the one the KEKs were wrapped with. */
export class MasterKeyMismatchError extends InternalError {
  constructor(expected: string, actual: string) {
    super(
      "The master key does not match the key-encryption keys in the database (E_MASTER_KEY_MISMATCH); restore the original FLOWAID_MASTER_KEY or key file",
      { code: "E_MASTER_KEY_MISMATCH", expectedKcv: expected, actualKcv: actual },
    );
  }
}

export class KeyRing {
  private readonly cache = new Map<number, Buffer>();

  constructor(
    private master: MasterKeyProvider,
    private readonly store: KekStore,
  ) {}

  /** Fails with MasterKeyMismatchError when any stored KEK was wrapped under a different master. */
  async verifyMaster(): Promise<void> {
    const kcv = await this.master.kcv();
    for (const row of await this.store.list()) {
      if (!constantTimeEqual(row.masterKcv, kcv))
        throw new MasterKeyMismatchError(row.masterKcv, kcv);
    }
  }

  /** The active KEK version, creating version 1 on first use. */
  async activeVersion(): Promise<number> {
    const rows = await this.store.list();
    const active = rows.find((r) => r.active);
    if (active) return active.version;
    return this.createVersion();
  }

  /** Adds a new KEK version and makes it active (new credentials use it; old ones keep theirs). */
  async createVersion(): Promise<number> {
    const rows = await this.store.list();
    const version = rows.reduce((max, r) => Math.max(max, r.version), 0) + 1;
    const kek = randomKey();
    try {
      await this.store.insert({
        version,
        wrappedKek: await this.master.wrap(kek),
        masterProvider: this.master.id,
        masterKcv: await this.master.kcv(),
        active: false,
      });
      await this.store.activate(version);
      this.cache.set(version, Buffer.from(kek));
    } finally {
      zeroise(kek);
    }
    return version;
  }

  async kek(version: number): Promise<Buffer> {
    const cached = this.cache.get(version);
    if (cached) return cached;
    const row = (await this.store.list()).find((r) => r.version === version);
    if (!row) throw new InternalError(`Key-encryption key version ${version} does not exist`);
    const kek = await this.master.unwrap(row.wrappedKek);
    this.cache.set(version, kek);
    return kek;
  }

  /**
   * Re-wraps every KEK under `next` in one atomic store call, then switches to it. Data keys and
   * ciphertexts are untouched, so no credential needs re-encrypting.
   */
  async rotateMaster(next: MasterKeyProvider): Promise<void> {
    await this.verifyMaster();
    const kcv = await next.kcv();
    const rows = await this.store.list();
    const rewrapped = [];
    for (const row of rows) {
      const kek = await this.master.unwrap(row.wrappedKek);
      try {
        rewrapped.push({
          version: row.version,
          wrappedKek: await next.wrap(kek),
          masterProvider: next.id,
          masterKcv: kcv,
        });
      } finally {
        zeroise(kek);
      }
    }
    await this.store.rewrap(rewrapped);
    this.master = next;
  }

  /** Drops cached KEKs from memory (zeroised). */
  forget(): void {
    for (const kek of this.cache.values()) zeroise(kek);
    this.cache.clear();
  }
}

/** An in-memory KekStore for tests and single-process tools. */
export class MemoryKekStore implements KekStore {
  readonly rows: KekRow[] = [];
  list() {
    return Promise.resolve(this.rows.map((r) => ({ ...r })));
  }
  insert(row: KekRow) {
    this.rows.push({ ...row });
    return Promise.resolve();
  }
  activate(version: number) {
    for (const r of this.rows) r.active = r.version === version;
    return Promise.resolve();
  }
  rewrap(
    rows: readonly {
      version: number;
      wrappedKek: string;
      masterProvider: string;
      masterKcv: string;
    }[],
  ) {
    for (const update of rows) {
      const row = this.rows.find((r) => r.version === update.version);
      if (row) Object.assign(row, update);
    }
    return Promise.resolve();
  }
}
