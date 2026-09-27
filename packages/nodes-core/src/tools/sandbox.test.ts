import { describe, expect, it } from "vitest";
import { runNode } from "@flowaid/node-sdk/testing";
import type {
  SandboxBridges,
  SandboxExecutor,
  SandboxRunRequest,
  ToolDefinition,
} from "@flowaid/workflow-core";
import { codeNode } from "./code.js";
import { shellNode } from "./shell.js";

/** A fake executor that records requests and exercises the bridges it is given. */
function fakeExecutor(behaviour: (req: SandboxRunRequest, b: SandboxBridges) => Promise<unknown>) {
  const requests: SandboxRunRequest[] = [];
  const executor: SandboxExecutor = {
    kind: "container",
    run: async (req, b) => {
      requests.push(req);
      return {
        output: (await behaviour(req, b)) as never,
        logs: [{ level: "info", message: "ran" }],
        durationMs: 3,
      };
    },
    shell: (req) =>
      Promise.resolve({
        exitCode: req.script.includes("fail") ? 2 : 0,
        stdout: `out:${req.stdin ?? ""}`,
        stderr: "err",
        durationMs: 4,
      }),
  };
  return { executor, requests };
}

const tool = (name: string, approvalRequired: boolean) => ({
  definition: {
    name,
    description: "",
    inputSchema: { type: "object" },
    idempotency: "safe",
    approvalRequired,
    source: { kind: "builtin", id: name },
  } satisfies ToolDefinition,
  handler: () => ({ ok: true, content: "", structured: { called: name }, latencyMs: 1 }),
});

describe("flowaid.tools.code", () => {
  it("sends the request to the sandbox and forwards logs", async () => {
    const { executor, requests } = fakeExecutor((req) =>
      Promise.resolve({ n: (req.inputs.n as number) * 2 }),
    );
    const r = await runNode(codeNode, {
      config: { code: "return { n: inputs.n * 2 }", output: { type: "object" } },
      input: { inputs: { n: 2 } },
      sandbox: executor,
    });
    expect(r.result).toMatchObject({ kind: "ok", output: { result: { n: 4 }, duration_ms: 3 } });
    expect(requests[0]).toMatchObject({
      language: "typescript",
      allowNetwork: false,
      tools: [],
      outputSchema: { type: "object" },
      memoryMb: 128,
    });
    expect(r.recorder.logs).toEqual([{ level: "info", message: "ran" }]);
  });

  it("bridges: network only to allowed hosts, tools only when listed and not approval-gated, run-scoped state", async () => {
    const { executor } = fakeExecutor(async (_req, b) => {
      const out: Record<string, unknown> = {};
      out.allowed = (await b.fetch?.("https://api.example.com/x"))?.status;
      out.blocked = await b.fetch?.("https://evil.test/x").then(
        () => "fetched",
        (e: Error) => e.message,
      );
      out.tool = await b.callTool?.("lookup", {});
      out.unlisted = await b.callTool?.("other", {}).catch((e: Error) => e.message);
      out.gated = await b.callTool?.("refund", {}).catch((e: Error) => e.message);
      await b.stateSet?.("k", 1);
      return out;
    });
    const r = await runNode(codeNode, {
      config: {
        code: "return 1",
        allowNetwork: true,
        allowedHosts: ["*.example.com"],
        tools: ["lookup", "refund"],
      },
      sandbox: executor,
      http: () => Promise.resolve(new Response("ok")),
      tools: [tool("lookup", false), tool("refund", true), tool("other", false)],
    });
    expect(r.result).toMatchObject({
      kind: "ok",
      output: {
        result: {
          allowed: 200,
          blocked: expect.stringContaining("not in allowedHosts"),
          tool: { called: "lookup" },
          unlisted: expect.stringContaining("not in config.tools"),
          gated: expect.stringContaining("SandboxToolNeedsApproval"),
        },
      },
    });
    expect(r.recorder.stateWrites).toEqual([{ namespace: "run", key: "run:run_test:k", value: 1 }]);
  });

  it("fails with SANDBOX_UNAVAILABLE without an executor", async () => {
    const r = await runNode(codeNode, { config: { code: "return 1" } });
    expect(r.result).toMatchObject({
      kind: "error",
      error: { code: "SANDBOX_ERROR", message: expect.stringContaining("SANDBOX_UNAVAILABLE") },
    });
  });
});

describe("flowaid.tools.shell", () => {
  it("returns output, routes or fails on non-zero exits", async () => {
    const { executor } = fakeExecutor(() => Promise.resolve(null));
    expect(
      (
        await runNode(shellNode, {
          config: { script: "echo" },
          input: { stdin: "x" },
          sandbox: executor,
        })
      ).result,
    ).toMatchObject({
      kind: "ok",
      output: { exit_code: 0, stdout: "out:x" },
    });
    expect(
      (await runNode(shellNode, { config: { script: "fail" }, sandbox: executor })).result,
    ).toMatchObject({ kind: "error", error: { code: "NODE_EXECUTION_ERROR" } });
    expect(
      (
        await runNode(shellNode, {
          config: { script: "fail", allowNonZeroExit: true },
          sandbox: executor,
        })
      ).result,
    ).toMatchObject({ kind: "ok", route: "nonzero" });
  });

  it("needs a shell-capable executor", async () => {
    const r = await runNode(shellNode, {
      config: { script: "echo" },
      sandbox: { kind: "isolated-vm", run: () => Promise.reject(new Error("x")) },
    });
    expect(r.result).toMatchObject({
      kind: "error",
      error: { message: expect.stringContaining("cannot run shell scripts") },
    });
  });
});
