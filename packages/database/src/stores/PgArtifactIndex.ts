/**
 * The artifact index: metadata rows in `artifacts` for whatever holds the bytes (S3/MinIO or the
 * local filesystem). Storage keys are generated here as `ws/<workspaceId>/<artifactId>`, never
 * from the user-supplied name, so a name cannot steer where bytes are written. Uploads stay
 * `pending` until `markReady` records the verified size and SHA-256.
 */
import { and, asc, eq, isNotNull, lte } from "drizzle-orm";
import { uuidv7 } from "@flowaid/shared";
import { ConflictError } from "@flowaid/workflow-core";
import type { Database, Tx } from "../db.js";
import { artifacts } from "../schema.js";

export type ArtifactRow = typeof artifacts.$inferSelect;
export type ArtifactKind = ArtifactRow["kind"];

export interface NewArtifact {
  workspaceId: string;
  runId?: string | null;
  nodeRunId?: string | null;
  workflowId?: string | null;
  name: string;
  mimeType: string;
  kind: ArtifactKind;
  storage: ArtifactRow["storage"];
  dataClass?: ArtifactRow["dataClass"];
  /** Known now (server-written bytes); omitted for uploads, which start `pending`. */
  bytes?: number;
  sha256?: string;
  expiresAt?: Date | null;
}

export function storageKey(workspaceId: string, artifactId: string): string {
  return `ws/${workspaceId}/${artifactId}`;
}

export class PgArtifactIndex {
  constructor(private readonly database: Database) {}

  private tx<T>(workspaceId: string | null, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return workspaceId ? this.database.tenant(workspaceId, fn) : this.database.system(fn);
  }

  async create(input: NewArtifact): Promise<ArtifactRow> {
    const id = uuidv7();
    const ready = input.bytes !== undefined && input.sha256 !== undefined;
    const [row] = await this.tx(input.workspaceId, (tx) =>
      tx
        .insert(artifacts)
        .values({
          id,
          workspaceId: input.workspaceId,
          runId: input.runId ?? null,
          nodeRunId: input.nodeRunId ?? null,
          workflowId: input.workflowId ?? null,
          name: input.name,
          mimeType: input.mimeType,
          bytes: input.bytes ?? 0,
          sha256: input.sha256 ?? "",
          storage: input.storage,
          storageKey: storageKey(input.workspaceId, id),
          kind: input.kind,
          status: ready ? "ready" : "pending",
          dataClass: input.dataClass ?? "internal",
          expiresAt: input.expiresAt ?? null,
        })
        .returning(),
    );
    return row as ArtifactRow;
  }

  async get(workspaceId: string, id: string): Promise<ArtifactRow | null> {
    const [row] = await this.tx(workspaceId, (tx) =>
      tx.select().from(artifacts).where(eq(artifacts.id, id)),
    );
    return row ?? null;
  }

  /** Completes an upload once the bytes were verified; a second completion is a conflict. */
  async markReady(
    workspaceId: string,
    id: string,
    verified: { bytes: number; sha256: string },
  ): Promise<ArtifactRow> {
    const [row] = await this.tx(workspaceId, (tx) =>
      tx
        .update(artifacts)
        .set({ status: "ready", bytes: verified.bytes, sha256: verified.sha256 })
        .where(and(eq(artifacts.id, id), eq(artifacts.status, "pending")))
        .returning(),
    );
    if (!row) throw new ConflictError(`Artifact ${id} is not a pending upload`);
    return row;
  }

  async delete(workspaceId: string, id: string): Promise<ArtifactRow | null> {
    const [row] = await this.tx(workspaceId, (tx) =>
      tx.delete(artifacts).where(eq(artifacts.id, id)).returning(),
    );
    return row ?? null;
  }

  /** Expired artifacts across workspaces (the sweep deletes their bytes, then the rows). */
  async expired(now: Date, limit: number): Promise<ArtifactRow[]> {
    return this.tx(null, (tx) =>
      tx
        .select()
        .from(artifacts)
        .where(and(isNotNull(artifacts.expiresAt), lte(artifacts.expiresAt, now)))
        .orderBy(asc(artifacts.expiresAt))
        .limit(limit),
    );
  }
}
