/**
 * Where the CLI connects and as whom: flags, then `FLOWAID_API_URL` / `FLOWAID_API_KEY` /
 * `FLOWAID_WORKSPACE`, then the profile `flowaid login` saved in
 * `$XDG_CONFIG_HOME/flowaid/config.json` (default `~/.config/flowaid/config.json`, mode 0600).
 */
import { join } from "node:path";
import { Flowaid } from "@flowaid/workflow-sdk";
import type { CliIO } from "./io.js";

export const DEFAULT_API_URL = "http://localhost:3000";

export interface Profile {
  apiUrl?: string;
  apiKey?: string;
  workspace?: string;
}

export interface GlobalOptions {
  apiUrl?: string;
  apiKey?: string;
  workspace?: string;
  output?: string;
  json?: boolean;
}

export function configPath(io: CliIO): string {
  const base = io.env.XDG_CONFIG_HOME || join(io.home, ".config");
  return join(base, "flowaid", "config.json");
}

export async function readProfile(io: CliIO): Promise<Profile> {
  try {
    return JSON.parse(await io.readText(configPath(io))) as Profile;
  } catch {
    return {};
  }
}

export async function writeProfile(io: CliIO, profile: Profile): Promise<string> {
  const path = configPath(io);
  await io.writeFile(path, `${JSON.stringify(profile, null, 2)}\n`, 0o600);
  return path;
}

export async function resolveConnection(
  io: CliIO,
  g: GlobalOptions,
): Promise<Required<Pick<Profile, "apiUrl">> & Profile> {
  const saved = await readProfile(io);
  const apiKey = g.apiKey ?? io.env.FLOWAID_API_KEY ?? saved.apiKey;
  const workspace = g.workspace ?? io.env.FLOWAID_WORKSPACE ?? saved.workspace;
  return {
    apiUrl: g.apiUrl ?? io.env.FLOWAID_API_URL ?? saved.apiUrl ?? DEFAULT_API_URL,
    ...(apiKey ? { apiKey } : {}),
    ...(workspace ? { workspace } : {}),
  };
}

export async function client(io: CliIO, g: GlobalOptions): Promise<Flowaid> {
  const c = await resolveConnection(io, g);
  return new Flowaid({
    baseUrl: c.apiUrl,
    ...(c.apiKey ? { apiKey: c.apiKey } : {}),
    ...(c.workspace ? { workspace: c.workspace } : {}),
    ...(io.fetch ? { fetch: io.fetch } : {}),
    headers: { "user-agent": "flowaid-cli/0.1" },
  });
}
