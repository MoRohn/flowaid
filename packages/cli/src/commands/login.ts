/** `flowaid login` / `flowaid logout`: verify an API key against `GET /v1/me` and save the profile. */
import type { Command } from "commander";
import { Flowaid } from "@flowaid/workflow-sdk";
import {
  configPath,
  readProfile,
  resolveConnection,
  writeProfile,
  type GlobalOptions,
} from "../config.js";
import type { CliIO } from "../io.js";

interface MeResponse {
  principal: { type: string; workspaceSlug?: string; scopes?: string[] };
  user?: { email?: string } | null;
}

export function registerLogin(program: Command, io: CliIO): void {
  program
    .command("login")
    .description(
      "save an API key (from --api-key, FLOWAID_API_KEY or stdin) for --api-url after checking it",
    )
    .action(async (_o: unknown, self: Command) => {
      const g = self.optsWithGlobals<GlobalOptions>();
      const c = await resolveConnection(io, g);
      const apiKey = c.apiKey ?? (await io.readStdin()).trim();
      if (!apiKey)
        throw new Error("no API key: pass --api-key, set FLOWAID_API_KEY or pipe it on stdin");
      const fa = new Flowaid({
        baseUrl: c.apiUrl,
        apiKey,
        ...(c.workspace ? { workspace: c.workspace } : {}),
        ...(io.fetch ? { fetch: io.fetch } : {}),
      });
      const me = await fa.transport.request<MeResponse>("GET", "/v1/me");
      const path = await writeProfile(io, {
        ...(await readProfile(io)),
        apiUrl: c.apiUrl,
        apiKey,
        ...(c.workspace ? { workspace: c.workspace } : {}),
      });
      const who = me.user?.email ?? `${me.principal.type}`;
      io.out(
        `Logged in to ${c.apiUrl} as ${who}${me.principal.workspaceSlug ? ` (workspace ${me.principal.workspaceSlug})` : ""}. Saved to ${path}.`,
      );
    });

  program
    .command("logout")
    .description("forget the saved API key")
    .action(async () => {
      const { apiKey: _drop, ...rest } = await readProfile(io);
      await writeProfile(io, rest);
      io.out(`Removed the API key from ${configPath(io)}.`);
    });
}
