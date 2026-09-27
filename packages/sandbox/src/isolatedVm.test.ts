import { describe, expect, it } from "vitest";
import type { SandboxBridges, SandboxRunRequest } from "@flowaid/workflow-core";
import { IsolatedVmSandbox, isolatedVmAvailable } from "./isolatedVm.js";

const available = await isolatedVmAvailable();
const sandbox = new IsolatedVmSandbox();
const req = (code: string, extra: Partial<SandboxRunRequest> = {}): SandboxRunRequest => ({
  language: "javascript",
  code,
  inputs: { n: 21 },
  timeoutMs: 2000,
  allowNetwork: false,
  allowedHosts: [],
  tools: [],
  ...extra,
});
const bridges = (extra: Partial<SandboxBridges> = {}): SandboxBridges => ({
  signal: new AbortController().signal,
  ...extra,
});

describe.skipIf(!available)("IsolatedVmSandbox", () => {
  it("runs a function body with inputs and captures logs", async () => {
    const r = await sandbox.run(
      req("console.log('n is', inputs.n, { a: 1 }); return { doubled: inputs.n * 2 };"),
      bridges(),
    );
    expect(r.output).toEqual({ doubled: 42 });
    expect(r.logs).toEqual([{ level: "info", message: 'n is 21 {"a":1}' }]);
  });

  it("transpiles TypeScript", async () => {
    const r = await sandbox.run(
      req(
        "const x: number = inputs.n as number; interface P { v: number } const p: P = { v: x + 1 }; return p;",
        { language: "typescript" },
      ),
      bridges(),
    );
    expect(r.output).toEqual({ v: 22 });
  });

  it("has no process, require or Node globals", async () => {
    const r = await sandbox.run(
      req(
        "return [typeof process, typeof require, typeof Buffer, typeof setTimeout === 'undefined' || true];",
      ),
      bridges(),
    );
    expect(r.output).toEqual(["undefined", "undefined", "undefined", true]);
  });

  it("ends a CPU-bound loop at the time limit", async () => {
    const started = Date.now();
    await expect(
      sandbox.run(req("while (true) {}", { timeoutMs: 300 }), bridges()),
    ).rejects.toMatchObject({
      code: "SANDBOX_ERROR",
      message: expect.stringMatching(/time limit|deadline/),
    });
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it("ends an await-forever at the wall-clock deadline", async () => {
    const started = Date.now();
    await expect(
      sandbox.run(req("await new Promise(() => {}); return 1;", { timeoutMs: 300 }), bridges()),
    ).rejects.toMatchObject({
      message: expect.stringContaining("wall-clock deadline"),
    });
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it("ends a loop that starts after an await at the deadline", async () => {
    await expect(
      sandbox.run(req("await Promise.resolve(); while (true) {}", { timeoutMs: 300 }), bridges()),
    ).rejects.toMatchObject({ code: "SANDBOX_ERROR" });
  });

  it("enforces the memory limit", async () => {
    await expect(
      sandbox.run(
        req("const a = []; while (true) a.push(new Array(1e6).fill(1));", {
          memoryMb: 16,
          timeoutMs: 10_000,
        }),
        bridges(),
      ),
    ).rejects.toMatchObject({
      message: expect.stringMatching(/memory limit|deadline/),
    });
  }, 20_000);

  it("rejects a 5 MiB return value and oversized inputs", async () => {
    await expect(
      sandbox.run(req("return 'x'.repeat(5 * 1024 * 1024);"), bridges()),
    ).rejects.toMatchObject({ message: expect.stringContaining("return value is larger") });
    await expect(
      sandbox.run(req("return 1;", { inputs: { big: "x".repeat(5 * 1024 * 1024) } }), bridges()),
    ).rejects.toMatchObject({ message: expect.stringContaining("inputs") });
  });

  it("gates fetch on the bridge and passes allowed calls through", async () => {
    await expect(
      sandbox.run(req("return (await fetch('https://api.example.com/x')).status;"), bridges()),
    ).rejects.toMatchObject({ message: expect.stringContaining("allowNetwork") });
    const seen: string[] = [];
    const fetch = (url: string) => (seen.push(url), Promise.resolve(Response.json({ ok: 1 })));
    const r = await sandbox.run(
      req(
        "const r = await fetch('https://api.example.com/x'); return { status: r.status, body: await r.json() };",
        { allowNetwork: true },
      ),
      bridges({ fetch }),
    );
    expect(r.output).toEqual({ status: 200, body: { ok: 1 } });
    expect(seen).toEqual(["https://api.example.com/x"]);
  });

  it("bridges tools and state, and surfaces bridge errors as exceptions in the code", async () => {
    const store = new Map<string, unknown>();
    const r = await sandbox.run(
      req(
        "await state.set('k', { v: inputs.n }); const got = await state.get('k'); const t = await tools.call('add', { a: 1, b: 2 }); let err = null; try { await tools.call('nope', {}); } catch (e) { err = e.message; } return { got, t, err };",
        { tools: ["add"] },
      ),
      bridges({
        stateGet: (k) => Promise.resolve((store.get(k) as never) ?? null),
        stateSet: (k, v) => (store.set(k, v), Promise.resolve()),
        callTool: (name, args) =>
          name === "add"
            ? Promise.resolve({
                sum: (args as { a: number; b: number }).a + (args as { a: number; b: number }).b,
              })
            : Promise.reject(new Error(`${name} is not allowed`)),
      }),
    );
    expect(r.output).toEqual({ got: { v: 21 }, t: { sum: 3 }, err: "nope is not allowed" });
  });

  it("validates the output schema", async () => {
    await expect(
      sandbox.run(
        req("return { total: 'many' };", {
          outputSchema: { type: "object", properties: { total: { type: "number" } } },
        }),
        bridges(),
      ),
    ).rejects.toMatchObject({
      code: "SCHEMA_VALIDATION_ERROR",
    });
  });

  it("maps thrown errors and compile errors", async () => {
    await expect(sandbox.run(req("throw new Error('bad input')"), bridges())).rejects.toMatchObject(
      { message: "the code threw: bad input" },
    );
    await expect(sandbox.run(req("return {"), bridges())).rejects.toMatchObject({
      message: expect.stringContaining("does not compile"),
    });
    await expect(
      sandbox.run(req("import fs from 'fs'; return 1;"), bridges()),
    ).rejects.toMatchObject({ code: "SANDBOX_ERROR" });
  });

  it("caps log lines", async () => {
    const r = await sandbox.run(
      req(
        "for (let i = 0; i < 1500; i++) console.log(i); console.log('x'.repeat(20000)); return 1;",
      ),
      bridges(),
    );
    expect(r.logs).toHaveLength(1001);
    expect(r.logs.at(-1)).toMatchObject({
      level: "warn",
      message: expect.stringContaining("dropped"),
    });
  });

  it("stops when the run is cancelled", async () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 100);
    await expect(
      sandbox.run(req("await new Promise(() => {});", { timeoutMs: 10_000 }), {
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ message: "the run was cancelled" });
  });
});

describe.skipIf(available)("IsolatedVmSandbox without a native build", () => {
  it("fails with SANDBOX_UNAVAILABLE", async () => {
    await expect(sandbox.run(req("return 1"), bridges())).rejects.toMatchObject({
      code: "SANDBOX_ERROR",
      message: expect.stringContaining("SANDBOX_UNAVAILABLE"),
    });
  });
});
