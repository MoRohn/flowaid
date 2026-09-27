/**
 * Everything the CLI touches outside itself — output streams, the environment, files, `fetch`,
 * child processes — behind one interface, so commands run unchanged under test.
 */
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname } from "node:path";

export interface CliIO {
  out(text: string): void;
  err(text: string): void;
  env: Readonly<Record<string, string | undefined>>;
  cwd: string;
  home: string;
  fetch?: typeof fetch;
  readText(path: string): Promise<string>;
  readStdin(): Promise<string>;
  writeFile(path: string, data: string | Uint8Array, mode?: number): Promise<void>;
  /** Runs a command with inherited stdio; resolves with its exit code. */
  exec(command: string, args: string[], o?: { cwd?: string }): Promise<number>;
}

export function nodeIO(): CliIO {
  return {
    out: (text) => void process.stdout.write(text.endsWith("\n") ? text : `${text}\n`),
    err: (text) => void process.stderr.write(text.endsWith("\n") ? text : `${text}\n`),
    env: process.env,
    cwd: process.cwd(),
    home: homedir(),
    readText: (path) => readFile(path, "utf8"),
    readStdin: async () => {
      const chunks: Buffer[] = [];
      for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
      return Buffer.concat(chunks).toString("utf8");
    },
    writeFile: async (path, data, mode) => {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, data, mode === undefined ? undefined : { mode });
    },
    exec: (command, args, o = {}) =>
      new Promise((resolve, reject) => {
        const child = spawn(command, args, { stdio: "inherit", cwd: o.cwd });
        child.on("error", reject);
        child.on("exit", (code) => resolve(code ?? 1));
      }),
  };
}
