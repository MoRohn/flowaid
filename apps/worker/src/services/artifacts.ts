/**
 * Artifacts: bytes in the instance's artifact storage (S3 when configured, else
 * `<data>/artifacts`) under `ws/<ws>/<id>` (never derived from the name), with an `artifacts` row
 * (sha256, size, data class, which store holds it).
 */
import { createHash } from "node:crypto";
import { artifacts, type Database } from "@flowaid/database";
import type { ArtifactAccess } from "@flowaid/node-sdk";
import { uuidv7 } from "@flowaid/shared";
import type { ArtifactStorage } from "@flowaid/storage";
import { NotFoundError, PayloadTooLargeError } from "@flowaid/workflow-core";
import type { ExecutionCall } from "@flowaid/workflow-runtime";
import { and, eq } from "drizzle-orm";

export const MAX_ARTIFACT_BYTES = 100 * 1024 * 1024;

export function artifactAccessFor(
  db: Database,
  storage: ArtifactStorage,
  call: ExecutionCall,
): ArtifactAccess {
  return {
    put: async (name, data, mimeType, opts) => {
      const bytes = typeof data === "string" ? Buffer.from(data, "utf8") : Buffer.from(data);
      if (bytes.byteLength > MAX_ARTIFACT_BYTES)
        throw new PayloadTooLargeError(`an artifact is limited to ${MAX_ARTIFACT_BYTES} bytes`);
      const id = uuidv7();
      const key = `ws/${call.workspaceId}/${id}`;
      await storage.primary.put(key, bytes, mimeType);
      await db.tenant(call.workspaceId, (tx) =>
        tx.insert(artifacts).values({
          id,
          workspaceId: call.workspaceId,
          runId: call.runId,
          nodeRunId: call.nodeRunId,
          name: name.slice(0, 255),
          mimeType,
          bytes: bytes.byteLength,
          sha256: createHash("sha256").update(bytes).digest("hex"),
          storage: storage.primary.kind,
          storageKey: key,
          kind: "file",
          dataClass: opts?.dataClass ?? "internal",
        }),
      );
      call.emit({
        type: "ARTIFACT_CREATED",
        artifactId: id,
        name,
        mimeType,
        bytes: bytes.byteLength,
        dataClass: opts?.dataClass ?? "internal",
      } as never);
      return { $artifact: id };
    },
    get: async (id) => {
      const [row] = await db.tenant(call.workspaceId, (tx) =>
        tx
          .select()
          .from(artifacts)
          .where(and(eq(artifacts.id, id), eq(artifacts.workspaceId, call.workspaceId))),
      );
      if (!row) throw new NotFoundError(`artifact ${id} not found`);
      return storage.forKind(row.storage).get(row.storageKey);
    },
    url: (id) => Promise.resolve(`/v1/artifacts/${id}/download`),
  };
}
