/** A heartbeat file the container health check reads (`src/health.ts` compares its age). */
import { writeFile } from "node:fs/promises";

export function startHeartbeat(path: string, everyMs = 10_000): () => void {
  const beat = () =>
    void writeFile(path, JSON.stringify({ at: new Date().toISOString(), pid: process.pid })).catch(
      () => undefined,
    );
  beat();
  const t = setInterval(beat, everyMs);
  t.unref();
  return () => clearInterval(t);
}
