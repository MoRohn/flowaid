/**
 * Hand-written run commands: `run events <id> [--follow]` (the event log, or with `--follow` the
 * live SSE stream with Last-Event-ID resume until the run ends) and `run stream <id>` (the raw
 * stream as JSON lines, deltas included).
 */
import type { Command } from "commander";
import type { RunEvent } from "@flowaid/workflow-core";
import type { Page } from "@flowaid/workflow-sdk";
import { client, type GlobalOptions } from "../config.js";
import type { CliIO } from "../io.js";
import { outputFormat, render } from "../values.js";

/** One line per event for humans: `#seq TYPE node — detail`. */
export function describeEvent(ev: RunEvent): string {
  const e = ev as RunEvent & {
    nodeId?: string;
    error?: { code?: string; message?: string };
    decision?: { value?: unknown; confidence?: number };
    outcome?: string | null;
  };
  const parts = [`${e.seq ? `#${e.seq} ` : ""}${e.type}`];
  if (e.nodeId) parts.push(e.nodeId);
  if (e.decision)
    parts.push(
      `→ ${JSON.stringify(e.decision.value)} (confidence ${e.decision.confidence ?? "?"})`,
    );
  if (e.error) parts.push(`— ${e.error.code ?? ""} ${e.error.message ?? ""}`.trimEnd());
  if (e.type === "RUN_COMPLETED" && e.outcome) parts.push(`outcome ${e.outcome}`);
  return parts.join(" ");
}

export function registerRunCommands(run: Command, io: CliIO): void {
  run
    .command("events")
    .description("the run's durable events; --follow streams them live until the run ends")
    .argument("<id>", "run id")
    .option("--follow", "stream live (SSE with Last-Event-ID resume)")
    .option("--after <seq>", "only events after this seq", "0")
    .option("--limit <n>", "page size without --follow", "500")
    .option("--types <list>", "comma-separated event types")
    .action(
      async (
        id: string,
        o: { follow?: boolean; after: string; limit: string; types?: string },
        self: Command,
      ) => {
        const g = self.optsWithGlobals<GlobalOptions>();
        const fa = await client(io, g);
        const types = o.types?.split(",") as RunEvent["type"][] | undefined;
        if (o.follow) {
          for await (const ev of fa.run(id).stream({
            after: Number(o.after),
            deltas: false,
            ...(types ? { types } : {}),
          }))
            io.out(g.json || g.output ? JSON.stringify(ev) : describeEvent(ev));
          return;
        }
        const page = await fa.transport.request<Page<RunEvent>>("GET", `/v1/runs/${id}/events`, {
          query: {
            after: Number(o.after),
            limit: Number(o.limit),
            ...(o.types ? { types: o.types } : {}),
          },
        });
        io.out(render(page, outputFormat(g)));
      },
    );

  run
    .command("stream")
    .description("the run's live event stream as JSON lines (deltas included)")
    .argument("<id>", "run id")
    .option("--after <seq>", "resume after this seq", "0")
    .option("--no-deltas", "leave out GENERATION_DELTA events")
    .option("--until <when>", "terminal | suspend | never", "terminal")
    .action(
      async (id: string, o: { after: string; deltas: boolean; until: string }, self: Command) => {
        const fa = await client(io, self.optsWithGlobals<GlobalOptions>());
        if (!["terminal", "suspend", "never"].includes(o.until))
          throw new Error("--until must be terminal, suspend or never");
        for await (const ev of fa.run(id).stream({
          after: Number(o.after),
          deltas: o.deltas,
          until: o.until as "terminal",
        }))
          io.out(JSON.stringify(ev));
      },
    );
}
