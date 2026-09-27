/**
 * Hand-written workflow commands (API.md §8.3):
 *
 * - `workflow run <id> --input @f.json [--watch]`: starts a run on the server; `--watch` streams
 *   its events until it ends. `workflow run --local <file|dir>` runs the definition with the
 *   embedded runtime instead (no server).
 * - `workflow export <id> [--version n|draft] [--format json|yaml|ts]`: one file.
 * - `workflow package <id> [--version n|draft] [--out ./flow.zip] [--mode npm|vendored]`: the
 *   runnable code package.
 *
 * `--version n` resolves to `/v1/workflow-versions/:versionId/…`; `draft` (the default) to the
 * draft routes.
 */
import type { Command } from "commander";
import type { Flowaid } from "@flowaid/workflow-sdk";
import type { DurableRunEvent, JsonValue, WorkflowDefinition } from "@flowaid/workflow-core";
import { runLocally } from "@flowaid/workflow-runtime";
import { client, type GlobalOptions } from "../config.js";
import type { CliIO } from "../io.js";
import {
  loadDefinition,
  localNodes,
  localProviders,
  localSandbox,
  localSecrets,
} from "../local.js";
import { outputFormat, readValue, render } from "../values.js";
import { describeEvent } from "./runs.js";

interface RunFlags {
  input?: string;
  local?: boolean;
  watch?: boolean;
  sync?: boolean;
  environment?: string;
  versionId?: string;
  wait?: string;
  secret: string[];
  approve?: boolean;
}

const collect = (value: string, previous: string[]) => [...previous, value];

export async function versionIdFor(
  fa: Flowaid,
  workflowId: string,
  version: string,
): Promise<string> {
  const n = Number(version);
  if (!Number.isInteger(n) || n < 1)
    throw new Error(`--version must be a version number or 'draft' (got ${version})`);
  const versions = await fa.transport.request<{ id: string; version: number }[]>(
    "GET",
    `/v1/workflows/${encodeURIComponent(workflowId)}/versions`,
  );
  const match = versions.find((v) => v.version === n);
  if (!match) throw new Error(`workflow ${workflowId} has no published version ${n}`);
  return match.id;
}

async function runRemote(io: CliIO, g: GlobalOptions, id: string, o: RunFlags): Promise<void> {
  const fa = await client(io, g);
  const input = (o.input ? await readValue(io, o.input) : {}) as JsonValue;
  const run = await fa.workflows.run(id, input, {
    mode: o.sync ? "sync" : "async",
    ...(o.environment ? { environmentId: o.environment } : {}),
    ...(o.versionId ? { versionId: o.versionId } : {}),
    ...(o.wait ? { waitTimeoutMs: Number(o.wait) } : {}),
  });
  if (!o.watch) {
    io.out(render(run.accepted, outputFormat(g)));
    return;
  }
  io.err(`run ${run.id} (${run.initialStatus})`);
  for await (const ev of run.stream({ deltas: false })) io.err(describeEvent(ev));
  const done = await run.get();
  io.out(
    render(
      {
        run_id: done.id,
        status: done.status,
        output: done.output,
        outcome: done.outcome,
        error: done.error,
      },
      outputFormat(g),
    ),
  );
  if (done.status !== "completed") process.exitCode = 1;
}

async function runLocal(io: CliIO, g: GlobalOptions, path: string, o: RunFlags): Promise<void> {
  const definition = await loadDefinition(io, path);
  const input = (o.input ? await readValue(io, o.input) : {}) as JsonValue;
  const result = await runLocally(definition as WorkflowDefinition, {
    input,
    nodes: localNodes,
    providers: localProviders(),
    secrets: localSecrets(io, definition, o.secret),
    sandbox: localSandbox(),
    ...(o.watch ? { onEvent: (ev: DurableRunEvent) => io.err(describeEvent(ev)) } : {}),
    ...(o.approve ? { human: () => Promise.resolve({ action: "approve" as const }) } : {}),
  });
  io.out(
    render(
      {
        run_id: result.runId,
        status: result.status,
        output: result.output,
        outcome: result.outcome,
        error: result.error,
        usage: result.usage,
        cost_usd: result.costUsd,
      },
      outputFormat(g),
    ),
  );
  if (result.status !== "completed") process.exitCode = 1;
}

export function registerWorkflowCommands(workflow: Command, io: CliIO): void {
  workflow
    .command("run")
    .description("run a workflow on the server (by id) or, with --local, a definition file here")
    .argument("<target>", "workflow id, or with --local a .json/.yaml file or a package directory")
    .option("--input <json>", "run input (JSON, @file or -)")
    .option("--local", "run with the embedded runtime instead of the server")
    .option("--watch", "stream the run's events to stderr until it ends")
    .option("--sync", "wait for the result on the server (mode: sync)")
    .option("--environment <id>", "environment id (server runs)")
    .option("--version-id <id>", "pin a version (server runs)")
    .option("--wait <ms>", "sync wait timeout in ms")
    .option(
      "--secret <NAME=value>",
      "secret for --local runs (repeatable; declared secrets also read the environment)",
      collect,
      [],
    )
    .option("--approve", "--local: approve every human task")
    .action(async (target: string, o: RunFlags, self: Command) => {
      const g = self.optsWithGlobals<GlobalOptions>();
      if (o.local) await runLocal(io, g, target, o);
      else await runRemote(io, g, target, o);
    });

  workflow
    .command("export")
    .description("export a version or the draft as one file (json | yaml | ts)")
    .argument("<id>", "workflow id")
    .option("--version <n|draft>", "published version number, or draft", "draft")
    .option("--format <format>", "json | yaml | ts", "json")
    .option("--out <file>", "write to a file instead of stdout")
    .action(
      async (id: string, o: { version: string; format: string; out?: string }, self: Command) => {
        const fa = await client(io, self.optsWithGlobals<GlobalOptions>());
        const path =
          o.version === "draft"
            ? `/v1/workflows/${encodeURIComponent(id)}/draft/export`
            : `/v1/workflow-versions/${await versionIdFor(fa, id, o.version)}/export`;
        const res = await fa.transport.raw("GET", path, { query: { format: o.format } });
        const text = await res.text();
        if (o.out) {
          await io.writeFile(o.out, text);
          io.err(`wrote ${o.out}`);
        } else io.out(text);
      },
    );

  workflow
    .command("package")
    .description("download the runnable code package (zip) of a version or the draft")
    .argument("<id>", "workflow id")
    .option("--version <n|draft>", "published version number, or draft", "draft")
    .option("--out <file>", "where to write the zip", "./flow.zip")
    .option("--mode <mode>", "npm | vendored", "npm")
    .action(
      async (id: string, o: { version: string; out: string; mode: string }, self: Command) => {
        const fa = await client(io, self.optsWithGlobals<GlobalOptions>());
        if (o.mode !== "npm" && o.mode !== "vendored")
          throw new Error("--mode must be npm or vendored");
        const version = o.version === "draft" ? ("draft" as const) : Number(o.version);
        if (version !== "draft" && (!Number.isInteger(version) || version < 1))
          throw new Error(`--version must be a version number or 'draft' (got ${o.version})`);
        const zip = await fa.workflows.exportPackage(id, { version, mode: o.mode });
        await io.writeFile(o.out, zip);
        io.out(`wrote ${o.out} (${zip.byteLength} bytes)`);
      },
    );
}
