/**
 * Local master keys (`env` and `file` providers): the master is 32 bytes held in memory; KEKs
 * are sealed with AES-256-GCM under it (AAD `flowaid/kek`), and the KCV is the HMAC of the master.
 */
import { closeSync, openSync, readFileSync, writeSync, constants } from "node:fs";
import { CredentialError } from "@flowaid/workflow-core";
import { keyCheckValue, open, parseKey, randomKey, seal } from "../cipher.js";
import type { MasterKeyProvider, MasterProviderId } from "./types.js";

const KEK_AAD = "flowaid/kek";

class LocalMasterKey implements MasterKeyProvider {
  constructor(
    readonly id: MasterProviderId,
    private readonly master: Buffer,
  ) {}

  wrap(kek: Uint8Array): Promise<string> {
    return Promise.resolve(seal(this.master, kek, KEK_AAD));
  }

  unwrap(wrapped: string): Promise<Buffer> {
    try {
      return Promise.resolve(open(this.master, wrapped, KEK_AAD));
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
  }

  kcv(): Promise<string> {
    return Promise.resolve(keyCheckValue(this.master));
  }
}

/** `FLOWAID_MASTER_KEY`: base64 (44 chars) or hex (64 chars). */
export function envMasterKey(value: string): MasterKeyProvider {
  return new LocalMasterKey("env", parseKey(value, "FLOWAID_MASTER_KEY"));
}

export interface FileMasterKeyOptions {
  path: string;
  /** Create the file when it does not exist (always outside production; opt-in in production). */
  autogenerate: boolean;
  /**
   * Serialises creation across processes (the api holds `pg_advisory_xact_lock(hashtext('flowaid.master_key'))`
   * while it runs). Defaults to running `fn` directly.
   */
  withLock?: <T>(fn: () => T | Promise<T>) => Promise<T>;
  /** Called once when a new key file is written (the caller logs a loud warning). */
  onCreated?: (path: string) => void;
}

/**
 * `FLOWAID_MASTER_KEY_FILE`. A missing file is created with `O_CREAT | O_EXCL` and mode 0600, so
 * two processes racing to create it can never both win; the loser reads the winner's key.
 */
export async function fileMasterKey(options: FileMasterKeyOptions): Promise<MasterKeyProvider> {
  const read = (): Buffer | undefined => {
    try {
      return parseKey(readFileSync(options.path, "utf8"), `The master key file ${options.path}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  };
  const existing = read();
  if (existing) return new LocalMasterKey("file", existing);
  if (!options.autogenerate) {
    throw new CredentialError(
      `The master key file ${options.path} does not exist; set FLOWAID_MASTER_KEY, point FLOWAID_MASTER_KEY_FILE at a backed-up key, or allow FLOWAID_MASTER_KEY_AUTOGENERATE`,
    );
  }
  const create = (): Buffer => {
    const key = randomKey();
    let fd: number;
    try {
      fd = openSync(options.path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        const winner = read();
        if (winner) return winner;
      }
      throw error;
    }
    try {
      writeSync(fd, `${key.toString("base64")}\n`);
    } finally {
      closeSync(fd);
    }
    options.onCreated?.(options.path);
    return key;
  };
  const key = options.withLock ? await options.withLock(create) : create();
  return new LocalMasterKey("file", key);
}
