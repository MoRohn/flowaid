/**
 * `flowaid dev`: brings the local stack up with Docker Compose (`docker/compose.yml` of the
 * checkout the command runs in) and opens the web app; `--down` stops it.
 */
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Command } from "commander";
import type { CliIO } from "../io.js";

/** The nearest directory at or above `from` holding `docker/compose.yml`. */
export function findComposeRoot(
  from: string,
  exists: (p: string) => boolean = existsSync,
): string | null {
  let dir = from;
  for (;;) {
    if (exists(join(dir, "docker", "compose.yml"))) return dir;
    const up = dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

export function registerDev(program: Command, io: CliIO): void {
  program
    .command("dev")
    .description("start the local stack (docker compose) and open the web app")
    .option("--down", "stop the stack instead")
    .option("--no-open", "do not open the browser")
    .option("--web-url <url>", "the web app URL to open", "http://localhost:3000")
    .action(async (o: { down?: boolean; open: boolean; webUrl: string }) => {
      const root = findComposeRoot(io.cwd);
      if (!root) throw new Error("docker/compose.yml not found here or in a parent directory");
      const file = join(root, "docker", "compose.yml");
      const code = await io.exec(
        "docker",
        ["compose", "-f", file, ...(o.down ? ["down"] : ["up", "-d", "--wait"])],
        { cwd: root },
      );
      if (code !== 0) throw new Error(`docker compose exited with ${code}`);
      if (o.down) return;
      io.out(`FlowAId is up: ${o.webUrl} (API http://localhost:3001, reference at /docs).`);
      if (o.open) {
        const opener =
          process.platform === "darwin"
            ? "open"
            : process.platform === "win32"
              ? "explorer"
              : "xdg-open";
        await io.exec(opener, [o.webUrl]).catch(() => 1);
      }
    });
}
