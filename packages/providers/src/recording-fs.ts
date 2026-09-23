/**
 * File-backed FixtureStore for record/replay (Node only; exported as
 * `@flowaid/providers/recording-fs`). One JSON file per provider under the fixture directory
 * (`fixtures/providers/<provider>.json`), keys sorted so recordings diff cleanly in review.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { JsonValue } from "@flowaid/workflow-core";
import type { FixtureStore } from "./recording.js";

export class FileFixtureStore implements FixtureStore {
  private readonly cache = new Map<string, Record<string, JsonValue>>();

  constructor(private readonly directory: string) {}

  private fileFor(key: string): string {
    const provider = key.split("/")[0] ?? "provider";
    return join(this.directory, `${provider.replace(/[^a-z0-9._-]/gi, "_")}.json`);
  }

  private load(file: string): Record<string, JsonValue> {
    let entries = this.cache.get(file);
    if (!entries) {
      try {
        entries = JSON.parse(readFileSync(file, "utf8")) as Record<string, JsonValue>;
      } catch {
        entries = {};
      }
      this.cache.set(file, entries);
    }
    return entries;
  }

  get(key: string): JsonValue | undefined {
    return this.load(this.fileFor(key))[key];
  }

  set(key: string, value: JsonValue): void {
    const file = this.fileFor(key);
    const entries = this.load(file);
    entries[key] = value;
    const sorted = Object.fromEntries(
      Object.entries(entries).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
    );
    mkdirSync(this.directory, { recursive: true });
    writeFileSync(file, `${JSON.stringify(sorted, null, 2)}\n`);
  }
}
