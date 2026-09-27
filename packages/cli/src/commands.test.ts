import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import { runCli } from "./program.js";
import { fakeIo, json } from "./test/fakeIo.js";

const RUN = "0190b5a4-0000-7000-8000-000000000001";
const WF = "0190b5a4-0000-7000-8000-00000000000a";

const hello = {
  $schema: "https://flowaid.dev/schemas/workflow/v1",
  id: "0190b5a4-0000-7000-8000-0000000000cc",
  name: "Hello",
  inputs: { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
  outputs: { type: "object", properties: { greeting: { type: "string" } } },
  nodes: [
    { id: "start", kind: "input", name: "Start" },
    {
      id: "done",
      kind: "output",
      name: "Done",
      value: {
        kind: "object",
        fields: { greeting: { kind: "template", source: "Hello {{ start.name }}" } },
      },
    },
  ],
  edges: [{ id: "c1", from: { node: "start", port: "done" }, to: { node: "done" } }],
};

describe("generated commands", () => {
  it("fills path, query and body from arguments and flags; prints YAML on request", async () => {
    const t = fakeIo([
      (c) =>
        c.url.pathname === `/v1/runs/${RUN}`
          ? json(200, { id: RUN, status: "completed" })
          : undefined,
    ]);
    const code = await runCli(
      ["run", "get", RUN, "--include", "node_runs", "-o", "yaml", "--api-key", "fa_test_k"],
      t.io,
    );
    expect(code).toBe(0);
    expect(t.calls[0]?.url.search).toBe("?include=node_runs");
    expect(t.calls[0]?.headers.authorization).toBe("Bearer fa_test_k");
    expect(parseYaml(t.stdout.join("\n"))).toEqual({ id: RUN, status: "completed" });
  });

  it("builds bodies from --body @file and typed flags (arrays, numbers, booleans, JSON)", async () => {
    const t = fakeIo([(c) => (c.method === "POST" ? json(201, { ok: true }) : undefined)], {
      files: { "base.json": JSON.stringify({ name: "from file", mode: "test" }) },
    });
    const code = await runCli(
      [
        "api-key",
        "create",
        "--body",
        "@base.json",
        "--name",
        "ci",
        "--scopes",
        "runs:read,runs:create",
        "--rate-limit-per-min",
        "120",
        "--service-account",
        '{"name":"ci-bot"}',
        "--workflow-ids",
        `["${WF}"]`,
      ],
      t.io,
    );
    expect(t.stderr).toEqual([]);
    expect(code).toBe(0);
    expect(t.calls[0]?.body).toEqual({
      name: "ci",
      mode: "test",
      scopes: ["runs:read", "runs:create"],
      rateLimitPerMin: 120,
      serviceAccount: { name: "ci-bot" },
      workflowIds: [WF],
    });
  });

  it("reports API errors on stderr with exit code 1", async () => {
    const t = fakeIo([
      () =>
        json(409, {
          error: { code: "CONFLICT", message: "slug taken", retryable: false, request_id: "req-9" },
        }),
    ]);
    const code = await runCli(["workflow", "update", WF, "--slug", "x"], t.io);
    expect(code).toBe(1);
    expect(t.stderr.join("\n")).toBe("error: CONFLICT (409) slug taken [request req-9]");
  });

  it("accepts the plural noun as an alias", async () => {
    const t = fakeIo([() => json(200, { items: [], next_cursor: null })]);
    expect(await runCli(["workflows", "list", "--json"], t.io)).toBe(0);
    expect(t.calls[0]?.url.pathname).toBe("/v1/workflows");
  });
});

describe("hand-written commands", () => {
  it("login checks the key and saves the profile with mode 0600; env overrides it later", async () => {
    const t = fakeIo([
      (c) =>
        c.url.pathname === "/v1/me"
          ? json(200, { principal: { type: "api_key", workspaceSlug: "default" }, user: null })
          : undefined,
    ]);
    expect(
      await runCli(["--api-url", "https://flow.example", "login", "--api-key", "fa_live_k"], t.io),
    ).toBe(0);
    expect(t.calls[0]?.url.origin).toBe("https://flow.example");
    expect(t.modes.get("/cfg/flowaid/config.json")).toBe(0o600);
    expect(JSON.parse(t.files.get("/cfg/flowaid/config.json") as string)).toEqual({
      apiUrl: "https://flow.example",
      apiKey: "fa_live_k",
    });
    expect(t.stdout.join("")).toContain("workspace default");

    t.calls.length = 0;
    await runCli(["me", "get"], t.io);
    expect(t.calls[0]?.url.origin).toBe("https://flow.example");
    expect(t.calls[0]?.headers.authorization).toBe("Bearer fa_live_k");
    expect(await runCli(["logout"], t.io)).toBe(0);
    expect(JSON.parse(t.files.get("/cfg/flowaid/config.json") as string)).toEqual({
      apiUrl: "https://flow.example",
    });
  });

  it("workflow export --version n resolves the version id; draft uses the draft route", async () => {
    const t = fakeIo([
      (c) =>
        c.url.pathname === `/v1/workflows/${WF}/versions`
          ? json(200, [{ id: "v-2", version: 2 }])
          : undefined,
      (c) =>
        c.url.pathname.endsWith("/export")
          ? json(200, "name: Hello\n", "application/yaml")
          : undefined,
    ]);
    expect(
      await runCli(["workflow", "export", WF, "--version", "2", "--format", "yaml"], t.io),
    ).toBe(0);
    expect(t.calls[1]?.url.pathname).toBe("/v1/workflow-versions/v-2/export");
    expect(t.calls[1]?.url.search).toBe("?format=yaml");
    expect(t.stdout).toEqual(["name: Hello\n"]);
    await runCli(["workflow", "export", WF], t.io);
    expect(t.calls[2]?.url.pathname).toBe(`/v1/workflows/${WF}/draft/export`);
  });

  it("workflow run --watch streams events and prints the result", async () => {
    const sse = [
      `id: 1\nevent: RUN_CREATED\ndata: ${JSON.stringify({ type: "RUN_CREATED", seq: 1, runId: RUN })}\n\n`,
      `id: 2\nevent: RUN_COMPLETED\ndata: ${JSON.stringify({ type: "RUN_COMPLETED", seq: 2, runId: RUN, outcome: "sent" })}\n\n`,
      `event: END\ndata: ${JSON.stringify({ run_id: RUN, final_status: "completed" })}\n\n`,
    ].join("");
    const t = fakeIo(
      [
        (c) =>
          c.method === "POST"
            ? json(202, {
                run_id: RUN,
                status: "queued",
                links: { self: "", stream: "", output: "" },
              })
            : undefined,
        (c) =>
          c.url.pathname.endsWith("/stream") ? json(200, sse, "text/event-stream") : undefined,
        (c) =>
          c.url.pathname === `/v1/runs/${RUN}`
            ? json(200, {
                id: RUN,
                status: "completed",
                output: { ok: 1 },
                outcome: "sent",
                error: null,
              })
            : undefined,
      ],
      { files: { "in.json": '{"message":"hi"}' } },
    );
    const code = await runCli(
      ["workflow", "run", WF, "--input", "@in.json", "--watch", "--json"],
      t.io,
    );
    expect(code).toBe(0);
    expect(t.calls[0]?.body).toEqual({ mode: "async", input: { message: "hi" } });
    expect(t.stderr).toEqual([
      `run ${RUN} (queued)`,
      "#1 RUN_CREATED",
      "#2 RUN_COMPLETED outcome sent",
    ]);
    expect(JSON.parse(t.stdout.join(""))).toMatchObject({ status: "completed", output: { ok: 1 } });
  });

  it("run events --follow prints one line per event", async () => {
    const sse = `id: 5\nevent: NODE_COMPLETED\ndata: ${JSON.stringify({ type: "NODE_COMPLETED", seq: 5, nodeId: "draft" })}\n\nevent: END\ndata: {}\n\n`;
    const t = fakeIo([
      (c) => (c.url.pathname.endsWith("/stream") ? json(200, sse, "text/event-stream") : undefined),
    ]);
    expect(await runCli(["run", "events", RUN, "--follow", "--after", "4"], t.io)).toBe(0);
    expect(t.calls[0]?.headers["last-event-id"]).toBe("4");
    expect(t.stdout).toEqual(["#5 NODE_COMPLETED draft"]);
  });

  it("workflow package writes the zip", async () => {
    let polls = 0;
    const t = fakeIo([
      (c) =>
        c.url.pathname.endsWith("/draft/export/package") ? json(202, { job_id: "j" }) : undefined,
      (c) =>
        c.url.pathname === "/v1/jobs/j"
          ? json(
              200,
              polls++
                ? { id: "j", status: "completed", artifact_id: "a" }
                : { id: "j", status: "queued" },
            )
          : undefined,
      (c) =>
        c.url.pathname === "/v1/artifacts/a/download"
          ? new Response(new Uint8Array([80, 75]), {
              status: 200,
              headers: { "content-type": "application/zip" },
            })
          : undefined,
    ]);
    const code = await runCli(
      ["workflow", "package", WF, "--out", "flow.zip", "--mode", "vendored"],
      t.io,
    );
    expect(code).toBe(0);
    expect([...(t.files.get("flow.zip") as Uint8Array)]).toEqual([80, 75]);
    expect(t.calls[0]?.body).toEqual({ mode: "vendored" });
  });

  it("dev runs docker compose from the checkout", async () => {
    const t = fakeIo();
    t.io.cwd = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "packages");
    expect(await runCli(["dev", "--no-open"], t.io)).toBe(0);
    expect(t.execs[0]?.command).toBe("docker");
    expect(t.execs[0]?.args.slice(0, 1)).toEqual(["compose"]);
    expect(t.execs[0]?.args.slice(-3)).toEqual(["up", "-d", "--wait"]);
  });
});

describe("local commands", () => {
  it("validate compiles with the bundled core nodes (file or package directory)", async () => {
    const t = fakeIo([], {
      files: { "hello.json": JSON.stringify(hello), "pkg/workflow.json": JSON.stringify(hello) },
    });
    expect(await runCli(["validate", "hello.json"], t.io)).toBe(0);
    expect(t.stdout.at(-1)).toMatch(/^ok {2}planHash [0-9a-f]{64}$/);
    expect(await runCli(["validate", "pkg", "--json"], t.io)).toBe(0);

    const broken = {
      ...hello,
      nodes: [
        ...hello.nodes,
        { id: "x", kind: "task", name: "X", type: "flowaid.nope.nope", typeVersion: "1.0.0" },
      ],
    };
    const b = fakeIo([], { files: { "b.json": JSON.stringify(broken) } });
    expect(await runCli(["validate", "b.json"], b.io)).toBe(1);
    expect(b.stdout.join("\n")).toContain("error");
    process.exitCode = 0;
  });

  it("workflow run --local executes with the embedded runtime", async () => {
    const t = fakeIo([], { files: { "hello.json": JSON.stringify(hello) } });
    const code = await runCli(
      [
        "workflow",
        "run",
        "--local",
        "hello.json",
        "--input",
        '{"name":"Ada"}',
        "--watch",
        "--json",
      ],
      t.io,
    );
    expect(code).toBe(0);
    expect(JSON.parse(t.stdout.join(""))).toMatchObject({
      status: "completed",
      output: { greeting: "Hello Ada" },
    });
    expect(t.stderr.some((l) => l.includes("RUN_COMPLETED"))).toBe(true);
    expect(t.calls).toHaveLength(0);
  });

  it("a golden fixture validates at publish level with the bundled nodes", async () => {
    const path = join(
      dirname(fileURLToPath(import.meta.url)),
      "../../workflow-core/fixtures/example-support-reply.json",
    );
    const t = fakeIo([], { files: { "f.json": readFileSync(path, "utf8") } });
    expect(await runCli(["validate", "f.json", "--json"], t.io)).toBe(0);
    expect(JSON.parse(t.stdout.join(""))).toMatchObject({ ok: true });
  });
});

describe("import external", () => {
  const exportFile = readFileSync(
    join(
      dirname(fileURLToPath(import.meta.url)),
      "..",
      "..",
      "importer",
      "fixtures",
      "chatflow-llm-chain.json",
    ),
    "utf8",
  );

  it("--local translates on this machine and writes the definition and a report", async () => {
    const t = fakeIo([], { files: { "flow.json": exportFile } });
    const code = await runCli(
      ["import", "external", "flow.json", "--local", "--out", "wf.json", "--name", "Translator"],
      t.io,
    );
    expect(code).toBe(1); // the export has one unsupported component
    process.exitCode = 0;
    const def = JSON.parse(t.files.get("wf.json") as string) as {
      name: string;
      nodes: { type?: string }[];
    };
    expect(def.name).toBe("Translator");
    expect(def.nodes.some((n) => n.type === "flowaid.dev.todo")).toBe(true);
    expect(t.stderr.join("\n")).toMatch(
      /1 imported, 2 converted, 0 need configuration, 1 unsupported/,
    );
  });

  it("sends the export to the server, or previews it with --dry-run", async () => {
    const report = {
      format: "chatflow",
      workflowName: "Translator",
      counts: { imported: 1, converted: 2, needsConfig: 0, unsupported: 1 },
      nodes: [],
      issues: [],
      secrets: ["ANTHROPIC_API_KEY"],
    };
    const t = fakeIo(
      [
        (c) =>
          c.url.pathname === "/v1/workflows/import/preview"
            ? json(200, { report, definition: {}, diagnostics: [] })
            : c.url.pathname === "/v1/workflows/import"
              ? json(201, { report, workflow: { id: WF, name: "Translator" }, diagnostics: [] })
              : undefined,
      ],
      { files: { "flow.json": exportFile }, env: { FLOWAID_API_KEY: "fa_live_x" } },
    );
    expect(await runCli(["import", "external", "flow.json", "--dry-run"], t.io)).toBe(0);
    expect(t.calls[0]?.body).toMatchObject({ external: { nodes: expect.any(Array) } });
    expect(t.stdout.at(-1)).toBe("dry run: nothing was saved");
    expect(await runCli(["import", "external", "flow.json", "--name", "Translator"], t.io)).toBe(0);
    expect(t.calls[1]?.url.pathname).toBe("/v1/workflows/import");
    expect(t.calls[1]?.body).toMatchObject({ name: "Translator" });
    expect(t.stdout.at(-1)).toBe(`created workflow ${WF} "Translator"`);
    expect(t.stdout.join("\n")).toContain("secrets to bind: ANTHROPIC_API_KEY");
  });
});
