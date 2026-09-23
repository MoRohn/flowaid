/**
 * Credential storage for `@flowaid/credentials` (injected there; this package never imports it).
 *
 * - `PgCredentialRepository` implements workflow-core's `CredentialRepository`. RFC-0010: the
 *   `storage` column (`db` | `external`) is what `getCiphertext().provider` carries.
 * - `PgKekStore` implements the credentials `KekStore` (structurally): KEK versions in
 *   `encryption_keys`, exactly one active, rewrapped atomically on master-key rotation.
 */
import { and, asc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import type { CredentialRepository, SecretName } from "@flowaid/workflow-core";
import type { Database, Tx } from "../db.js";
import { credentials, encryptionKeys, secretReferences } from "../schema.js";

export interface PgCredentialRepositoryOptions {
  /** Scope to one workspace (row-level security); default: system scope (the worker). */
  workspaceId?: string;
}

export class PgCredentialRepository implements CredentialRepository {
  constructor(
    private readonly database: Database,
    private readonly options: PgCredentialRepositoryOptions = {},
  ) {}

  private tx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.options.workspaceId
      ? this.database.tenant(this.options.workspaceId, fn)
      : this.database.system(fn);
  }

  async getCiphertext(credentialId: string): Promise<{
    workspaceId: string;
    type: string;
    ciphertext: string;
    wrappedDataKey: string;
    keyVersion: number;
    provider: string;
    externalRef: string | null;
    scopes: string[];
  } | null> {
    const [row] = await this.tx((tx) =>
      tx.select().from(credentials).where(eq(credentials.id, credentialId)),
    );
    if (!row) return null;
    return {
      workspaceId: row.workspaceId,
      type: row.type,
      ciphertext: row.ciphertext ?? "",
      wrappedDataKey: row.wrappedDataKey ?? "",
      keyVersion: row.keyVersion ?? 0,
      provider: row.storage,
      externalRef: row.externalRef,
      scopes: row.scopes,
    };
  }

  async resolveBinding(
    workflowId: string,
    environmentId: string,
    secretName: SecretName,
  ): Promise<string | null> {
    const [row] = await this.tx((tx) =>
      tx
        .select({ credentialId: secretReferences.credentialId })
        .from(secretReferences)
        .innerJoin(credentials, eq(credentials.id, secretReferences.credentialId))
        .where(
          and(
            eq(secretReferences.workflowId, workflowId),
            eq(secretReferences.environmentId, environmentId),
            eq(secretReferences.secretName, secretName),
            // A credential pinned to another environment, or not allowed for this workflow, never resolves.
            or(isNull(credentials.environmentId), eq(credentials.environmentId, environmentId)),
            or(
              isNull(credentials.allowedWorkflowIds),
              sql`${credentials.allowedWorkflowIds} @> ${JSON.stringify([workflowId])}::jsonb`,
            ),
          ),
        ),
    );
    return row?.credentialId ?? null;
  }

  async touch(credentialId: string, usedAt: Date): Promise<void> {
    await this.tx((tx) =>
      tx.update(credentials).set({ lastUsedAt: usedAt }).where(eq(credentials.id, credentialId)),
    );
  }

  /** Credentials still sealed under an older KEK version (for `rotate()` batches). */
  async staleKeyVersion(activeVersion: number, limit: number): Promise<string[]> {
    const rows = await this.tx((tx) =>
      tx
        .select({ id: credentials.id })
        .from(credentials)
        .where(
          and(eq(credentials.storage, "db"), sql`${credentials.keyVersion} <> ${activeVersion}`),
        )
        .limit(limit),
    );
    return rows.map((r) => r.id);
  }

  /** Stores a re-sealed value (credential rotation or KEK migration). */
  async saveSealed(
    credentialId: string,
    sealed: {
      ciphertext: string;
      wrappedDataKey: string;
      keyVersion: number;
      publicFields: Record<string, string>;
    },
  ): Promise<void> {
    await this.tx((tx) =>
      tx
        .update(credentials)
        .set({ ...sealed, rotatedAt: sql`now()`, updatedAt: sql`now()` })
        .where(eq(credentials.id, credentialId)),
    );
  }
}

export interface KekRow {
  version: number;
  wrappedKek: string;
  masterProvider: string;
  masterKcv: string;
  active: boolean;
}

export class PgKekStore {
  constructor(private readonly database: Database) {}

  async list(): Promise<KekRow[]> {
    const rows = await this.database.system((tx) =>
      tx.select().from(encryptionKeys).orderBy(asc(encryptionKeys.version)),
    );
    return rows.map((r) => ({
      version: r.version,
      wrappedKek: r.wrappedKek,
      masterProvider: r.masterProvider,
      masterKcv: r.masterKcv,
      active: r.active,
    }));
  }

  async insert(row: KekRow): Promise<void> {
    await this.database.system(async (tx) => {
      if (row.active) await tx.update(encryptionKeys).set({ active: false });
      await tx.insert(encryptionKeys).values(row);
    });
  }

  async activate(version: number): Promise<void> {
    await this.database.system(async (tx) => {
      const [found] = await tx
        .select({ v: encryptionKeys.version })
        .from(encryptionKeys)
        .where(eq(encryptionKeys.version, version));
      if (!found) throw new Error(`KEK version ${version} does not exist`);
      await tx.update(encryptionKeys).set({ active: sql`${encryptionKeys.version} = ${version}` });
    });
  }

  async rewrap(
    rows: readonly {
      version: number;
      wrappedKek: string;
      masterProvider: string;
      masterKcv: string;
    }[],
  ): Promise<void> {
    await this.database.system(async (tx) => {
      const versions = rows.map((r) => r.version);
      const existing = await tx
        .select({ v: encryptionKeys.version })
        .from(encryptionKeys)
        .where(inArray(encryptionKeys.version, versions));
      if (existing.length !== rows.length)
        throw new Error("rewrap names a KEK version that does not exist");
      for (const r of rows) {
        await tx
          .update(encryptionKeys)
          .set({
            wrappedKek: r.wrappedKek,
            masterProvider: r.masterProvider,
            masterKcv: r.masterKcv,
          })
          .where(eq(encryptionKeys.version, r.version));
      }
    });
  }
}
