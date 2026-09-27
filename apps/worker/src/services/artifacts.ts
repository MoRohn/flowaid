/**
 * Artifacts: bytes on local disk under the instance data directory (`<data>/artifacts/ws/<ws>/<id>`,
 * never derived from the name) with an `artifacts` row (sha256, size, data class). S3/MinIO storage
 * slots in behind the same interface.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { artifacts, type Database } from "@flowaid/database";
import type { ArtifactAccess } from "@flowaid/node-sdk";
import { uuidv7 } from "@flowaid/shared";
import { NotFoundError, PayloadTooLargeError } from "@flowaid/workflow-core";
import type { ExecutionCall } from "@flowaid/workflow-runtime";
import { and, eq } from "drizzle-orm";

export const MAX_ARTIFACT_BYTES = 100 * 1024 * 1024;

export function artifactAccessFor(db: Database, root: string, call: ExecutionCall): ArtifactAccess {
  return {
    put: async (name, data, mimeType, opts) => {
      const bytes = typeof data === "string" ? Buffer.from(data, "utf8") : Buffer.from(data);
      if (bytes.byteLength > MAX_ARTIFACT_BYTES)
        throw new PayloadTooLargeError(`an artifact is limited to ${MAX_ARTIFACT_BYTES} bytes`);
      const id = uuidv7();
      const key = `ws/${call.workspaceId}/${id}`;
      const path = join(root, key);
      await mkdir(dirname(path), { recursive: true, mode: 0o700 });
      await writeFile(path, bytes, { mode: 0o600 });
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
          storage: "local",
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
      if (!row || row.storage !== "local") throw new NotFoundError(`artifact ${id} not found`);
      return new Uint8Array(await readFile(join(root, row.storageKey)));
    },
    url: (id) => Promise.resolve(`/v1/artifacts/${id}/download`),
  };
}
